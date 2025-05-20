import {
  static_text_render_once,
  StaticTextContainer as RustyStaticTextContainer,
  strip_ansi_codes,
} from "./lib/rs_lib.js";

export type TextItem = string | HangingTextItem;

export interface HangingTextItem {
  text: string;
  indent?: number;
}

export interface ConsoleSize {
  columns: number | undefined;
  rows: number | undefined;
}

const scopesSymbol = Symbol();
const getItemsSymbol = Symbol();
const renderOnceSymbol = Symbol();

export class StaticTextScope implements Disposable {
  #container: StaticTextContainer;
  #items: TextItem[] = [];

  constructor(container: StaticTextContainer) {
    this.#container = container;
    this.#container[scopesSymbol].push(this);
  }

  [Symbol.dispose]() {
    const index = this.#container[scopesSymbol].indexOf(this);
    if (index >= 0) {
      this.#container[scopesSymbol].splice(index, 1);
    }
  }

  private [getItemsSymbol](): ReadonlyArray<TextItem> {
    return this.#items;
  }

  /** Sets the text to render for this scope. */
  setText(text: string): void;
  /** Sets the items for this scope. */
  setText(items: TextItem[]): void;
  setText(textOrItems: TextItem[] | string): void {
    if (typeof textOrItems === "string") {
      textOrItems = [{ text: textOrItems, indent: 0 }];
    }
    this.#items = textOrItems;
  }

  /** Logs the provided text above the static text. */
  logAbove(text: string, size?: ConsoleSize): void;
  logAbove(items: TextItem[], size?: ConsoleSize): void;
  logAbove(textOrItems: TextItem[] | string, size?: ConsoleSize) {
    size ??= this.#container.getConsoleSize();
    this.#container.clear(size);
    if (typeof textOrItems === "string") {
      textOrItems = [{ text: textOrItems, indent: 0 }];
    }
    this.#container[renderOnceSymbol](textOrItems, size);
  }

  /** Forces a refresh of the container. */
  refresh() {
    this.#container.refresh();
  }
}

export class StaticTextContainer {
  readonly #container = new RustyStaticTextContainer();
  private readonly [scopesSymbol]: StaticTextScope[] = [];
  readonly #getConsoleSize: () => ConsoleSize;
  readonly #onWriteText: (text: string) => void;

  constructor(
    onWriteText: (text: string) => void,
    getConsoleSize: () => ConsoleSize,
  ) {
    this.#onWriteText = onWriteText;
    this.#getConsoleSize = getConsoleSize;
  }

  /** Creates a scope which can be used to set the text for. */
  createScope(): StaticTextScope {
    return new StaticTextScope(this);
  }

  /** Gets the containers current console size. */
  getConsoleSize(): ConsoleSize {
    try {
      return this.#getConsoleSize();
    } catch {
      return { columns: undefined, rows: undefined };
    }
  }

  /** Clears the text and flushes it to the console. */
  clear(size?: ConsoleSize) {
    const newText = this.renderClearText(size);
    if (newText != null) {
      this.#onWriteText(newText);
    }
  }

  /** Refreshes the static text (writes it to the console). */
  refresh(size?: ConsoleSize) {
    const newText = this.renderRefreshText(size);
    if (newText != null) {
      this.#onWriteText(newText);
    }
  }

  /**
   * Renders the clear text.
   *
   * Note: this is a low level method. Prefer calling `.clear()` instead.
   */
  renderClearText(size?: ConsoleSize): string | undefined {
    const { columns, rows } = size ?? this.#getConsoleSize();
    return this.#container.clear_text(columns, rows);
  }

  /**
   * Renders the next text that should be displayed.
   *
   * Note: This is a low level method. Prefer calling `.refresh()` instead.
   */
  renderRefreshText(size?: ConsoleSize): string | undefined {
    const { columns, rows } = size ?? this.#getConsoleSize();
    const length = this[scopesSymbol].map((p) => p[getItemsSymbol]().length)
      .reduce((a, b) => a + b, 0);
    const items = new Array(length);
    let i = 0;
    for (const provider of this[scopesSymbol]) {
      for (const item of provider[getItemsSymbol]()) {
        items[i++] = item;
      }
    }
    return this.#container.render_text(items, columns, rows);
  }

  private [renderOnceSymbol](items: TextItem[], size: ConsoleSize) {
    const { columns, rows } = size;
    const newText = static_text_render_once(items, columns, rows);
    if (newText != null) {
      this.#onWriteText(newText + "\r\n");
    }
  }
}

const encoder = new TextEncoder();

/**
 * Global `StaticTextContainer` that can be shared amongst many libraries.
 * This writes the static text to stderr and gets the real console size.
 */
export const staticText: StaticTextContainer = new StaticTextContainer(
  (text) => {
    const bytes = encoder.encode(text);
    let written = 0;
    while (written < bytes.length) {
      written += Deno.stderr.writeSync(bytes.subarray(written));
    }
  },
  () => Deno.consoleSize(),
);

export interface RenderIntervalScope extends Disposable {
}

/** Renders a container at an interval. */
export class RenderInterval {
  #count = 0;
  #intervalId: ReturnType<typeof setInterval> | undefined = undefined;
  #container: StaticTextContainer;
  #intervalMs = 60;

  constructor(container: StaticTextContainer) {
    this.#container = container;
  }

  get intervalMs(): number {
    return this.#intervalMs;
  }

  set intervalMs(value: number) {
    if (this.#intervalMs === value) {
      return;
    }

    this.#intervalMs = value;
    if (this.#intervalId != null) {
      this.#stopInterval();
      this.#startInterval();
    }
  }

  /** Starts the render task returning a disposable for stopping it. */
  start(): RenderIntervalScope {
    if (this.#count === 0) {
      this.#startInterval();
    }

    this.#count++;
    let hasCalled = false;
    return {
      [Symbol.dispose]: () => {
        if (!hasCalled) {
          hasCalled = true;
          this.#count--;
          if (this.#count === 0) {
            this.#stopInterval();
            this.#container.refresh();
          }
        }
      },
    };
  }

  #startInterval() {
    this.#intervalId = setInterval(() => {
      this.#container.refresh();
    }, this.#intervalMs);
  }

  #stopInterval() {
    if (this.#intervalId == null) {
      return;
    }
    clearInterval(this.#intervalId);
    this.#intervalId = undefined;
  }
}

export const renderInterval: RenderInterval = new RenderInterval(staticText);

/** Convenience function for stripping ANSI codes.
 * Exposed because it's used in the rust crate. */
export function stripAnsiCodes(text: string): string {
  return strip_ansi_codes(text);
}

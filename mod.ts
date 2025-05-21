import {
  static_text_render_once,
  StaticTextContainer as RustyStaticTextContainer,
  strip_ansi_codes,
} from "./lib/rs_lib.js";

export type TextItem = string | DeferredText | DetailedTextItem;

/** Text that's rendered at compile time. */
export type DeferredText = (size: ConsoleSize) => string;

export interface DetailedTextItem {
  text: string | DeferredText;
  indent?: number;
}

export interface ConsoleSize {
  columns: number | undefined;
  rows: number | undefined;
}

const scopesSymbol = Symbol();
const getItemsSymbol = Symbol();
const renderOnceSymbol = Symbol();
const onItemsChangedEventsSymbol = Symbol();

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
      this.#container.refresh();
    }
  }

  private [getItemsSymbol](): ReadonlyArray<TextItem> {
    return this.#items;
  }

  /** Sets the text to render for this scope. */
  setText(text: string): void;
  /** Text with a render function. */
  setText(deferredText: DeferredText): void;
  /** Sets the items for this scope. */
  setText(items: TextItem[]): void;
  setText(textOrItems: TextItem[] | string | DeferredText): void {
    if (typeof textOrItems === "string") {
      textOrItems = [{ text: textOrItems }];
    } else if (textOrItems instanceof Function) {
      textOrItems = [{ text: textOrItems }];
    }
    this.#items = textOrItems;
    this.#notifyContainerOnItemsChanged();
  }

  #notifyContainerOnItemsChanged() {
    for (const onChanged of this.#container[onItemsChangedEventsSymbol]) {
      onChanged();
    }
  }

  /** Logs the provided text above the static text. */
  logAbove(text: string, size?: ConsoleSize): void;
  logAbove(items: TextItem[], size?: ConsoleSize): void;
  logAbove(textOrItems: TextItem[] | string, size?: ConsoleSize) {
    this.#container.logAbove(textOrItems, size);
  }

  /** Forces a refresh of the container. */
  refresh(size?: ConsoleSize) {
    this.#container.refresh(size);
  }
}

export class StaticTextContainer {
  readonly #container = new RustyStaticTextContainer();
  private readonly [scopesSymbol]: StaticTextScope[] = [];
  readonly #getConsoleSize: () => ConsoleSize;
  readonly #onWriteText: (text: string) => void;
  private readonly [onItemsChangedEventsSymbol]: (() => void)[] = [];

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

  /** Logs the provided text above the static text. */
  logAbove(text: string, size?: ConsoleSize): void;
  logAbove(items: TextItem[], size?: ConsoleSize): void;
  logAbove(textOrItems: TextItem[] | string, size?: ConsoleSize): void;
  logAbove(textOrItems: TextItem[] | string, size?: ConsoleSize) {
    size ??= this.getConsoleSize();
    let detailedItem: DetailedTextItem[];
    if (typeof textOrItems === "string") {
      detailedItem = [{ text: textOrItems }];
    } else {
      // make a copy of the array
      detailedItem = textOrItems.map((item) => evalItem(item, size));
    }
    this.withTempClear(() => {
      this[renderOnceSymbol](detailedItem, size);
    }, size);
  }

  withTempClear(action: () => void, size?: ConsoleSize) {
    size ??= this.getConsoleSize();
    this.clear(size);
    try {
      action();
    } finally {
      this.refresh(size);
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
    size ??= this.#getConsoleSize();
    const length = this[scopesSymbol].map((p) => p[getItemsSymbol]().length)
      .reduce((a, b) => a + b, 0);
    const items = new Array(length);
    let i = 0;
    for (const provider of this[scopesSymbol]) {
      for (const item of provider[getItemsSymbol]()) {
        items[i++] = evalItem(item, size);
      }
    }
    return this.#container.render_text(items, size.columns, size.rows);
  }

  private [renderOnceSymbol](items: DetailedTextItem[], size: ConsoleSize) {
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
export class RenderInterval implements Disposable {
  #count = 0;
  #intervalId: ReturnType<typeof setInterval> | undefined = undefined;
  #container: StaticTextContainer;
  #intervalMs = 60;
  #containerSubscription: (() => void) | undefined;
  #disposed = false;

  constructor(container: StaticTextContainer) {
    this.#container = container;
  }

  [Symbol.dispose]() {
    this.#removeSubscriptionFromContainer();
    this.#stopInterval();
    this.#disposed = true;
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

  /**
   * Starts the render task returning a disposable for stopping it.
   *
   * Note that it's perfectly fine to just start this and never dispose it.
   * The underlying interval won't run if there's no items in the container.
   */
  start(): RenderIntervalScope {
    if (this.#disposed) {
      throw new Error("Cannot call .start() on a disposed RenderInterval.");
    }

    if (this.#count === 0) {
      this.#markStart();
    }

    this.#count++;
    let hasCalled = false;
    return {
      [Symbol.dispose]: () => {
        if (!hasCalled && !this.#disposed) {
          hasCalled = true;
          this.#count--;
          if (this.#count === 0) {
            this.#markStop();
            this.#container.refresh();
          }
        }
      },
    };
  }

  #containerHasItems() {
    return this.#container[scopesSymbol].some((s) =>
      s[getItemsSymbol]().length > 0
    );
  }

  #markStart() {
    if (this.#containerHasItems()) {
      this.#startInterval();
    } else {
      this.#addSubscriptionToContainer();
    }
  }

  #markStop() {
    if (this.#containerHasItems()) {
      this.#stopInterval();
    } else {
      this.#removeSubscriptionFromContainer();
    }
  }

  #startInterval() {
    this.#intervalId = setInterval(() => {
      this.#container.refresh();
      if (!this.#containerHasItems()) {
        this.#stopInterval();
        this.#addSubscriptionToContainer();
      }
    }, this.#intervalMs);
  }

  #stopInterval() {
    if (this.#intervalId == null) {
      return;
    }
    clearInterval(this.#intervalId);
    this.#intervalId = undefined;
  }

  #addSubscriptionToContainer() {
    this.#containerSubscription = () => {
      if (this.#containerHasItems()) {
        this.#container.refresh();
        this.#removeSubscriptionFromContainer();
        this.#startInterval();
      }
    };
    this.#container[onItemsChangedEventsSymbol].push(
      this.#containerSubscription,
    );
  }

  #removeSubscriptionFromContainer() {
    if (!this.#containerSubscription) {
      return;
    }
    const events = this.#container[onItemsChangedEventsSymbol];
    const removeIndex = events.indexOf(this.#containerSubscription);
    if (removeIndex >= 0) {
      events.splice(removeIndex, 1);
      this.#containerSubscription = undefined;
    }
  }
}

export const renderInterval: RenderInterval = new RenderInterval(staticText);

/** Convenience function for stripping ANSI codes.
 * Exposed because it's used in the rust crate. */
export function stripAnsiCodes(text: string): string {
  return strip_ansi_codes(text);
}

function evalItem(item: TextItem, size: ConsoleSize): DetailedTextItem {
  if (typeof item === "string") {
    return { text: item };
  } else if (item instanceof Function) {
    return { text: item(size) };
  } else if (item.text instanceof Function) {
    return {
      ...item,
      text: item.text(size),
    };
  } else {
    return item;
  }
}

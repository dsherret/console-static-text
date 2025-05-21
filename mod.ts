import {
  static_text_render_once,
  StaticTextContainer as RustyStaticTextContainer,
  strip_ansi_codes,
} from "./lib/rs_lib.js";

/** Text item to display. */
export type TextItem = string | DeferredItem | DetailedTextItem;

/** Function called on each render. */
export type DeferredItem = (size: ConsoleSize | undefined) => (TextItem | TextItem[]);

/** Item that also supports hanging indentation. */
export interface DetailedTextItem {
  text: string | DeferredItem;
  hangingIndent?: number;
}

interface WasmTextItem {
  text: string;
  hangingIndent?: number;
}

/** Console size. */
export interface ConsoleSize {
  /** Number of horizontal columns. */
  columns: number;
  /** Number of vertical rows. */
  rows: number;
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
  setText(deferredText: DeferredItem): void;
  /** Sets the items for this scope. */
  setText(items: TextItem[]): void;
  setText(textOrItems: TextItem[] | string | DeferredItem): void {
    if (typeof textOrItems === "string") {
      if (textOrItems.length === 0) {
        textOrItems = [];
      } else {
        textOrItems = [{ text: textOrItems }];
      }
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
  readonly #getConsoleSize: () => (ConsoleSize | undefined);
  readonly #onWriteText: (text: string) => void;
  private readonly [onItemsChangedEventsSymbol]: (() => void)[] = [];

  constructor(
    onWriteText: (text: string) => void,
    getConsoleSize: () => ConsoleSize | undefined,
  ) {
    this.#onWriteText = onWriteText;
    this.#getConsoleSize = getConsoleSize;
  }

  /** Creates a scope which can be used to set the text for. */
  createScope(): StaticTextScope {
    return new StaticTextScope(this);
  }

  /** Gets the containers current console size. */
  getConsoleSize(): ConsoleSize | undefined {
    return this.#getConsoleSize();
  }

  /** Logs the provided text above the static text. */
  logAbove(text: string, size?: ConsoleSize): void;
  logAbove(items: TextItem[], size?: ConsoleSize): void;
  logAbove(textOrItems: TextItem[] | string, size?: ConsoleSize): void;
  logAbove(textOrItems: TextItem[] | string, size?: ConsoleSize) {
    size ??= this.getConsoleSize();
    let detailedItem: WasmTextItem[];
    if (typeof textOrItems === "string") {
      if (textOrItems.length === 0) {
        detailedItem = [];
      } else {
        detailedItem = [{ text: textOrItems }];
      }
    } else {
      detailedItem = Array.from(resolveItems(textOrItems, size));
    }
    this.withTempClear(() => {
      this[renderOnceSymbol](detailedItem, size);
    }, size);
  }

  /** Clears the displayed text for the provided action. */
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
    size = size ?? this.#getConsoleSize();
    return this.#container.clear_text(size?.columns, size?.rows);
  }

  /**
   * Renders the next text that should be displayed.
   *
   * Note: This is a low level method. Prefer calling `.refresh()` instead.
   */
  renderRefreshText(size?: ConsoleSize): string | undefined {
    size ??= this.#getConsoleSize();
    const items = Array.from(this.#resolveItems(size));
    return this.#container.render_text(items, size?.columns, size?.rows);
  }

  *#resolveItems(size: ConsoleSize | undefined): Iterable<WasmTextItem> {
    for (const provider of this[scopesSymbol]) {
      for (const item of provider[getItemsSymbol]()) {
        yield* resolveItem(item, size);
      }
    }
  }

  private [renderOnceSymbol](items: WasmTextItem[], size: ConsoleSize | undefined) {
    const newText = static_text_render_once(items, size?.columns, size?.rows);
    if (newText != null) {
      this.#onWriteText(newText + "\r\n");
    }
  }
}

const encoder = new TextEncoder();

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

  /**
   * Constructs a new `RenderInterval` from the provided `StaticTextContainer`.
   * @param container Container to render every `intervalMs`.
   */
  constructor(container: StaticTextContainer) {
    this.#container = container;
  }

  [Symbol.dispose]() {
    this.#markStop();
    this.#disposed = true;
  }

  /** Gets how often this interval will refresh the output.
   * @default `60`
   */
  get intervalMs(): number {
    return this.#intervalMs;
  }

  /** Sets how often this should refresh the output. */
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
    this.#addSubscriptionToContainer();
    if (this.#containerHasItems()) {
      this.#container.refresh();
    }
  }

  #markStop() {
    this.#removeSubscriptionFromContainer();
    this.#stopInterval();
  }

  #startInterval() {
    this.#container.refresh();
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

  #addSubscriptionToContainer() {
    let lastValue = this.#containerHasItems();
    this.#containerSubscription = () => {
      const hasItems = this.#containerHasItems();
      if (hasItems != lastValue) {
        lastValue = hasItems;
        if (this.#containerHasItems()) {
          this.#startInterval();
        } else {
          this.#stopInterval();
        }
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
  () => consoleSize(),
);

export const renderInterval: RenderInterval = new RenderInterval(staticText);

/** Renders the text items to a string using no knowledge of a `StaticTextContainer`. */
export function renderTextItems(items: TextItem[], size?: ConsoleSize) {
  size ??= consoleSize();
  const wasmItems = Array.from(resolveItems(items, size));
  return static_text_render_once(wasmItems, size?.columns, size?.rows) ?? "";
}

/** Helper to get the console size and return undefined if it's not available. */
export function consoleSize(): ConsoleSize | undefined {
  try {
    return Deno.consoleSize();
  } catch {
    return undefined;
  }
}

/** Convenience function for stripping ANSI codes.
 * Exposed because it's used in the rust crate. */
export function stripAnsiCodes(text: string): string {
  return strip_ansi_codes(text);
}

function* resolveDeferred(
  deferred: DeferredItem,
  size: ConsoleSize | undefined,
): Iterable<WasmTextItem> {
  const value = deferred(size);
  if (value instanceof Array) {
    yield* resolveItems(value, size);
  } else {
    yield* resolveItem(value, size);
  }
}

function* resolveItems(
  value: TextItem[],
  size: ConsoleSize | undefined,
): Iterable<WasmTextItem> {
  for (const item of value) {
    yield* resolveItem(item, size);
  }
}

function* resolveItem(
  item: TextItem,
  size: ConsoleSize | undefined,
): Iterable<WasmTextItem> {
  if (typeof item === "string") {
    if (item.length > 0) {
      yield { text: item };
    }
  } else if (item instanceof Function) {
    yield* resolveDeferred(item, size);
  } else if (item.text instanceof Function) {
    const hangingIndent = item.hangingIndent ?? 0;
    for (const value of resolveDeferred(item.text, size)) {
      yield {
        ...value,
        hangingIndent: hangingIndent + (value.hangingIndent ?? 0),
      };
    }
  } else if (item.text.length > 0) {
    yield item as WasmTextItem;
  }
}

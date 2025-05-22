import { RenderInterval, StaticTextContainer } from "./mod.ts";
import { assertEquals } from "@std/assert";
import { delay } from "@std/async/delay";

function createVtsReplacements() {
  function vtsMoveUp(count: number) {
    if (count === 0) {
      throw new Error("Invalid.");
    }
    return `\x1B[${count}A`;
  }

  function vtsMoveDown(count: number) {
    if (count === 0) {
      throw new Error("Invalid.");
    }
    return `\x1B[${count}B`;
  }

  const vtsMoveToZeroCol = "\x1B[0G";
  const vtsClearCursorDown = "\x1B[2K\x1B[J";
  const vtsClearUntilNewline = "\x1B[K";

  const mappings: [string, string][] = [];
  for (let i = 1; i < 10; i++) {
    mappings.push([`~CUP${i}~`, vtsMoveUp(i)]);
    mappings.push([`~CDOWN${i}~`, vtsMoveDown(i)]);
  }
  mappings.push(["~CLEAR_CDOWN~", vtsClearCursorDown]);
  mappings.push(["~CLEAR_UNTIL_NEWLINE~", vtsClearUntilNewline]);
  mappings.push(["~MOVE0~", vtsMoveToZeroCol]);
  return mappings;
}

const replacements = createVtsReplacements();

function vtsReplace(text: string) {
  for (const replacement of replacements) {
    text = text.replaceAll(replacement[1], replacement[0]);
  }
  return text;
}

Deno.test("should set items", () => {
  let writtenText: string = "";
  const assertText = (text: string) => {
    assertEquals(vtsReplace(writtenText), text);
    writtenText = "";
  };

  const container = new StaticTextContainer(
    (text) => {
      writtenText += text;
    },
    () => ({ rows: 10, columns: 10 }),
  );
  const scope = container.createScope();
  scope.setText("Hello there this is a test");
  container.refresh();
  assertText("~MOVE0~~CLEAR_CDOWN~Hello\r\nthere this\r\nis a test~MOVE0~");
  scope.setText([{
    text: "something else",
    hangingIndent: 1,
  }]);
  container.refresh();
  assertText(
    "~MOVE0~~CUP2~something\r\n else~CLEAR_UNTIL_NEWLINE~~CDOWN1~~CLEAR_CDOWN~~CUP1~~MOVE0~",
  );

  const newScope = container.createScope();
  newScope.setText([{ text: "hello" }]);
  container.refresh();
  assertText("~MOVE0~~CUP1~something\r\n else\r\nhello~MOVE0~");

  newScope.logAbove("log");
  assertText(
    "~MOVE0~~CUP2~~CLEAR_CDOWN~~MOVE0~~CLEAR_CDOWN~log~MOVE0~\r\n~MOVE0~something\r\n else\r\nhello~MOVE0~",
  );
  container.clear();
  assertText("~MOVE0~~CUP2~~CLEAR_CDOWN~");
  newScope[Symbol.dispose]();
  container.refresh();
  assertText("~MOVE0~something\r\n else~MOVE0~");

  scope.setText(() => [
    "First",
    () => "Second",
  ]);
  newScope.refresh();
  assertText("~MOVE0~~CUP1~First~CLEAR_UNTIL_NEWLINE~\r\nSecond~MOVE0~");
});

Deno.test("render interval basic", async () => {
  let writtenText: string = "";
  const assertText = (text: string) => {
    assertEquals(vtsReplace(writtenText), text);
    writtenText = "";
  };

  const container = new StaticTextContainer(
    (text) => {
      writtenText += text;
    },
    () => ({ rows: 10, columns: 10 }),
  );
  const interval = new RenderInterval(container);
  interval.intervalMs = 5;
  using stop = interval.start();

  const scope = container.createScope();

  scope.setText("1");
  await delay(10);
  assertText("~MOVE0~~CLEAR_CDOWN~1~MOVE0~");
  scope.setText("hello");
  assertText("");
  await delay(10);
  assertText("~MOVE0~hello~MOVE0~");
  stop[Symbol.dispose]();
  scope.setText("no more updates because disposed");
  await delay(10);
  assertText("");
});

Deno.test("render interval refreshes on disposal", () => {
  let writtenText: string = "";
  const assertText = (text: string) => {
    assertEquals(vtsReplace(writtenText), text);
    writtenText = "";
  };

  const container = new StaticTextContainer(
    (text) => {
      writtenText += text;
    },
    () => ({ rows: 20, columns: 20 }),
  );
  using renderInterval = new RenderInterval(container);
  {
    using _renderScope = renderInterval.start(); // updates the displayed text periodically
    using scope = container.createScope(); // make sure this is second
    scope.setText(`Downloading...`);
    container.refresh();
    assertText("~MOVE0~~CLEAR_CDOWN~Downloading...~MOVE0~");
  }
  assertText("~MOVE0~~CLEAR_UNTIL_NEWLINE~~MOVE0~");
});

Deno.test("render interval no using, doesn't leak interval", async () => {
  let writtenText: string = "";
  const assertText = (text: string) => {
    assertEquals(vtsReplace(writtenText), text);
    writtenText = "";
  };

  const container = new StaticTextContainer(
    (text) => {
      writtenText += text;
    },
    () => ({ rows: 10, columns: 10 }),
  );
  const interval = new RenderInterval(container);
  interval.intervalMs = 5;
  interval.start(); // no dispose

  {
    using scope = container.createScope();
    scope.setText("1");
    await delay(10);
    assertText("~MOVE0~~CLEAR_CDOWN~1~MOVE0~");
  }

  // deno should not complain here about leaked intervals
});

Deno.test("render interval starts and stops", async () => {
  let writtenText: string = "";
  const assertText = (text: string) => {
    assertEquals(vtsReplace(writtenText), text);
    writtenText = "";
  };

  const container = new StaticTextContainer(
    (text) => {
      writtenText += text;
    },
    () => ({ rows: 20, columns: 20 }),
  );
  using renderInterval = new RenderInterval(container);
  renderInterval.intervalMs = 10;
  using _renderScope = renderInterval.start(); // updates the displayed text periodically
  using scope = container.createScope(); // make sure this is second
  scope.setText(`Downloading...`);
  await delay(15);
  assertText("~MOVE0~~CLEAR_CDOWN~Downloading...~MOVE0~");
  scope.setText("New");
  assertText("");
  scope.setText("");
  scope.setText("New"); // this will cause an immediate render because it was previously cleared
  assertText("~MOVE0~New~CLEAR_UNTIL_NEWLINE~~MOVE0~");
});

Deno.test("deferred rendering", () => {
  let writtenText: string = "";
  const assertText = (text: string) => {
    assertEquals(vtsReplace(writtenText), text);
    writtenText = "";
  };

  const container = new StaticTextContainer(
    (text) => {
      writtenText += text;
    },
    () => ({ rows: 20, columns: 20 }),
  );
  using scope = container.createScope();
  let i = 0;
  scope.setText(() => (i++).toString());
  scope.refresh();
  assertText("~MOVE0~~CLEAR_CDOWN~0~MOVE0~");
  scope.refresh();
  assertText("~MOVE0~1~MOVE0~");
  let j = 0;
  scope.setText([{
    text: () => `New: ${j++}`,
  }]);
  scope.refresh();
  assertText("~MOVE0~New: 0~MOVE0~");
  scope.refresh();
  assertText("~MOVE0~New: 1~MOVE0~");
});

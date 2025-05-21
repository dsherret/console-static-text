# `jsr:@david/console-static-text`

[![JSR](https://jsr.io/badges/@david/console-static-text)](https://jsr.io/@david/console-static-text)

For the Rust crate, go to
[console_static_text](https://github.com/dsherret/console_static_text).

Install:

```sh
deno add jsr:@david/console-static-text
```

Library for displaying text that should stay at the bottom of the console. This
measures words to handle wrapping and has some console resizing support. Example
use might be for displaying progress bars or rendering selections.

<video alt="Video showing a bunch of progress bars outputting while the user is making selections." controls muted loop playsinline src="videos/example_output.mp4"></video>

## Example

```ts
import { staticText } from "@david/console-static-text";
import { delay } from "@std/async/delay";

using scope = staticText.createScope();

scope.setText([
  "Some text",
  "Some very long text. ".repeat(10),
  () => `Time is: ${new Date()}`,
  (consoleSize) => `Console size: ${consoleSize.rows}, ${consoleSize.columns}`,
  () => {
    // or deferred and multiple lines.
    return [
      "Line 1",
      (consoleSize) => (Math.random() * consoleSize.columns!).toString(),
    ];
  },
]);
staticText.refresh(); // now draw to console window

await delay(1_000);
scope.logAbove("Hello!"); // this will be logged immediately above the other text
```

## Render interval

You can start a render interval for the duration of some work:

```ts
import { renderInterval, staticText } from "@david/console-static-text";
import { delay } from "@std/async/delay";

// defaults to 60
renderInterval.intervalMs = 30;

async function download() {
  using _renderScope = renderInterval.start(); // updates the displayed text periodically
  // make sure these are after so it's disposed before the render scope
  using timeScope = staticText.createScope();
  using downloadScope = staticText.createScope();
  const startTime = Date.now();
  timeScope.setText(() => `It's been ${Date.now() - startTime}ms`);
  for (let i = 0; i < 100; i++) {
    downloadScope.setText(`Downloading ${i}/100...`);
    await delay(30); // do some async work
  }
}

// will show the Downloading x/100... text for the duration
// of the function call and then clear the text on exit
await download();
```

Note this won't render if there's any blocking synchronous work. To do that, you
must force a refresh via `staticText.refresh()`.

## Hanging indentation

Hanging indentation is possible by providing `TextItem` objects.

```ts
import { staticText } from "@david/console-static-text";

using scope = staticText.createScope();

scope.setText([{
  text: "Some non-hanging text.",
}, {
  text: "Some long text that will wrap at a certain width.",
  hangingIndent: 4,
}]);

staticText.refresh(); // draw to console window
```

This is useful when implementing something like a selection UI where you want
text to wrap with hanging indentation.

## Singleton and instances

By default, the library has two exports that are singletons around
stderr—`staticText` and `renderInterval`. These are an instance of
`StaticTextContainer` and `RenderInterval` respectively. New instances of these
classes can be created and used instead of the singletons if you wish.

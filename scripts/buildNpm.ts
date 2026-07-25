import { build, emptyDir } from "@deno/dnt";

Deno.chdir(new URL("../", import.meta.url));

await emptyDir("./npm");

await build({
  entryPoints: ["./mod.ts"],
  outDir: "./npm",
  // the source is already written against node apis
  shims: {
    deno: {
      test: "dev",
    },
  },
  compilerOptions: {
    stripInternal: false,
    skipLibCheck: false,
    lib: ["ESNext"],
    target: "ES2022",
  },
  package: {
    name: "console-static-text",
    // only used for publishing, so a placeholder is fine for local builds
    version: Deno.args[0] ?? "0.0.0",
    description: "Display text that stays at the bottom of the console.",
    license: "MIT",
    repository: {
      type: "git",
      url: "git+https://github.com/dsherret/console-static-text.git",
    },
    keywords: [
      "console",
      "terminal",
      "progress",
      "static",
      "text",
    ],
    bugs: {
      url: "https://github.com/dsherret/console-static-text/issues",
    },
    devDependencies: {
      "@types/node": "^24.0.0",
    },
  },
  async postBuild() {
    Deno.copyFileSync("LICENSE", "npm/LICENSE");
    // the video is stored in the repo, so point at the raw url for npm
    const readme = await Deno.readTextFile("README.md");
    await Deno.writeTextFile(
      "npm/README.md",
      readme.replaceAll(
        'src="videos/',
        'src="https://raw.githubusercontent.com/dsherret/console-static-text/main/videos/',
      ),
    );
  },
});

import { resolveProjectRoot } from "../../shared/paths.js";
import * as snapshot from "../../engine/snapshot.js";

export default async function snapshotCommand(args: string[]): Promise<void> {
  const projectRoot = resolveProjectRoot();

  let message = "manual snapshot";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-m" || args[i] === "--message") {
      if (args[i + 1]) {
        message = args[i + 1];
        break;
      }
    } else if (args[i].startsWith("-m=") || args[i].startsWith("--message=")) {
      message = args[i].split("=")[1];
      break;
    }
  }

  console.log(`Creating snapshot: ${message}`);

  const result = await snapshot.snapshot({
    projectRoot,
    reason: message,
    type: "manual",
    trigger: "gts snapshot",
  });

  if (!result.committed) {
    console.log(`Snapshot ${result.reason}`);
    if (result.reason === "no-changes") {
      return;
    }
    if (result.error) {
      console.error(`Error: ${result.error}`);
    }
    process.exit(1);
  }

  console.log(`\nSnapshot created: ${result.shortHash}`);
  console.log(`Files copied: ${result.filesCopied.length}`);

  if (result.filesSkipped.length > 0) {
    console.log(`Files skipped: ${result.filesSkipped.length}`);
  }

  if (result.filesRedacted.length > 0) {
    console.log(`Files redacted: ${result.filesRedacted.length}`);
  }
}
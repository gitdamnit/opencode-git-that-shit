import { resolveProjectRoot } from "../../shared/paths.js";
import * as restore from "../../engine/restore.js";

export default async function restoreCommand(args: string[]): Promise<void> {
  const projectRoot = resolveProjectRoot();

  if (args.length === 0) {
    console.error(
      "Usage: gts restore <hash> [--dry-run] [--yes] [--overwrite] [--force] [--to-temp]"
    );
    process.exit(1);
  }

  const hash = args[0];
  const mode: "dry-run" | "overwrite" | "to-temp" = args.includes("--to-temp")
    ? "to-temp"
    : args.includes("--yes") || args.includes("--overwrite")
      ? "overwrite"
      : "dry-run";

  // --overwrite and --force both mean "overwrite conflicting files".
  const force = args.includes("--force") || args.includes("--overwrite");

  const targetHash = await restore.getRestoreTarget(projectRoot, hash);

  if (!targetHash) {
    console.error(`Snapshot not found: ${hash}`);
    process.exit(1);
  }

  const result = await restore.restoreSnapshot({
    projectRoot,
    hash: targetHash,
    mode,
    force,
  });

  if (result.error) {
    console.error(`Restore error: ${result.error}`);
    process.exit(1);
  }

  if (mode === "dry-run") {
    console.log("=== Dry-run mode ===\n");

    if (result.wouldRestore.length === 0) {
      console.log("No files would be restored.");
      return;
    }

    console.log("Would restore:");
    for (const file of result.wouldRestore) {
      console.log(`  ${file}`);
    }

    if (result.missing.length > 0) {
      console.log("\nMissing from project (will be created):");
      for (const file of result.missing) {
        console.log(`  ${file}`);
      }
    }

    if (result.conflicts.length > 0) {
      console.log("\nConflicting files (changed since snapshot):");
      for (const file of result.conflicts) {
        console.log(`  ${file}`);
      }
      console.log("\nConflicts are only overwritten with --force/--overwrite.");
    }

    if (result.redacted.length > 0) {
      console.log("\nRedacted files (snapshot holds placeholders; never restored):");
      for (const file of result.redacted) {
        console.log(`  ${file}`);
      }
    }

    console.log("\nTo perform restore, use: gts restore <hash> --yes");
    return;
  }

  if (mode === "to-temp") {
    console.log("=== Restore to temp mode ===\n");

    if (result.tempDir) {
      console.log(`Restored ${result.restored.length} files to: ${result.tempDir}`);
    }

    if (result.restored.length === 0) {
      console.log("No files were restored.");
    }
    return;
  }

  console.log("=== Restore mode ===\n");
  console.log(`Restored ${result.restored.length} file(s)`);

  if (result.created.length > 0) {
    console.log("\nCreated new files:");
    for (const file of result.created) {
      console.log(`  ${file}`);
    }
  }

  if (result.overwritten.length > 0) {
    console.log("\nOverwritten files:");
    for (const file of result.overwritten) {
      console.log(`  ${file}`);
    }
  }

  if (result.conflicts.length > 0) {
    console.log("\nConflicting files (need --force to overwrite):");
    for (const file of result.conflicts) {
      console.log(`  ${file}`);
    }
  }

  if (result.redacted.length > 0) {
    console.log("\nRedacted files skipped (snapshot holds placeholders; re-enter secrets manually):");
    for (const file of result.redacted) {
      console.log(`  ${file}`);
    }
  }

  if (result.preRestoreHash) {
    console.log(`\nPre-restore snapshot: ${result.preRestoreHash.slice(0, 7)}`);
  }
}

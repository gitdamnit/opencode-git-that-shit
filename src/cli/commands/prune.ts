import { resolveProjectRoot } from "../../shared/paths.js";
import { previewPrune, pruneSnapshots } from "../../engine/prune.js";

export default async function pruneCommand(args: string[]): Promise<void> {
  const projectRoot = resolveProjectRoot();

  let keep = 50;
  let confirm = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("-k=") || arg.startsWith("--keep=")) {
      keep = parseInt(arg.split("=")[1], 10);
    } else if (arg === "-k" || arg === "--keep") {
      if (args[i + 1]) {
        keep = parseInt(args[i + 1], 10);
        i++;
      }
    } else if (arg === "--yes" || arg === "-y") {
      confirm = true;
    }
  }

  const plan = await previewPrune(projectRoot, keep);

  if (plan.pruneCount === 0) {
    console.log(`Nothing to prune. ${plan.totalSnapshots} snapshots, keeping ${plan.keep}.`);
    return;
  }

  console.log(
    `Would prune ${plan.pruneCount} snapshot(s), keeping the newest ${plan.keep}.\n`
  );

  for (const snap of plan.toPrune) {
    console.log(`  ${snap.shortHash} | ${snap.type} | ${snap.reason}`);
  }

  if (!confirm) {
    console.log("\nDry-run mode. Use --yes to actually prune.");
    return;
  }

  const result = await pruneSnapshots(projectRoot, keep, true);

  if (result.error) {
    console.error(`\nPrune failed: ${result.error}`);
    if (result.backupPath) {
      console.error(`A safety backup was written to: ${result.backupPath}`);
    }
    process.exit(1);
  }

  console.log(`\nPruned ${result.pruneCount} snapshot(s), kept ${result.keep}.`);
  if (result.backupPath) {
    console.log(`Safety backup: ${result.backupPath}`);
  }
  console.log("Remaining snapshots reference real commits; run 'gts list' to verify.");
}

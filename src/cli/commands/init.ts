import * as path from "path";
import { resolveProjectRoot, getShadowRepoPath, fileExists } from "../../shared/paths.js";
import * as snapshot from "../../engine/snapshot.js";
import * as git from "../../engine/git.js";

export default async function initCommand(args: string[]): Promise<void> {
  const projectRoot = resolveProjectRoot();
  const shadowPath = getShadowRepoPath(projectRoot);

  const isAlreadyInit = fileExists(path.join(shadowPath, ".git"));
  if (isAlreadyInit) {
    console.log("Git That Shit already initialized");
    return;
  }

  console.log("Initializing Git That Shit...");

  const gitAvailable = await git.checkGitAvailable();

  if (!gitAvailable) {
    console.error("Error: Git is not available.");
    process.exit(1);
  }

  try {
    await snapshot.initShadowRepo(projectRoot);

    console.log(`Shadow repo initialized at: ${shadowPath}`);

    console.log("Creating initial snapshot...");
    const result = await snapshot.snapshot({
      projectRoot,
      reason: "initial snapshot",
      type: "manual",
      trigger: "gts init",
    });

    if (result.committed) {
      console.log(`Initial snapshot: ${result.shortHash}`);
    } else {
      console.log(`Snapshot skipped: ${result.reason}`);
    }

    console.log("\nGit That Shit is ready!");
    console.log("Run 'gts status' to verify.");
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
}
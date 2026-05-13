#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const main = async () => {
    const args = process.argv.slice(2);
    const cmd = args[0];
    if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
        console.log(`
Git That Shit — automatic pre-disaster snapshots

Usage: gts <command> [options]

Commands:
  gts status              Show Git That Shit status
  gts list [--count N]    List recent snapshots
  gts diff <hash>         Show what changed in a snapshot
  gts restore <hash>     Restore files (default: dry-run)
  gts snapshot [--message "msg"]  Manually trigger a snapshot
  gts prune [--keep N]    Preview or prune old snapshots
  gts config              Show current configuration
  gts init                Initialize shadow repo
  gts doctor              Run health diagnostics
  gts version             Show version
    `.trim());
        return;
    }
    if (cmd === "version" || cmd === "-v") {
        console.log("Git That Shit version 0.1.0");
        return;
    }
    const getCommand = async (name) => {
        const mod = await import(`./commands/${name}.js`);
        return mod.default?.default || mod.default;
    };
    const commands = {
        status: async () => { const fn = await getCommand("status"); await fn(args.slice(1)); },
        list: async () => { const fn = await getCommand("list"); await fn(args.slice(1)); },
        diff: async () => { const fn = await getCommand("diff"); await fn(args.slice(1)); },
        restore: async () => { const fn = await getCommand("restore"); await fn(args.slice(1)); },
        snapshot: async () => { const fn = await getCommand("snapshot"); await fn(args.slice(1)); },
        prune: async () => { const fn = await getCommand("prune"); await fn(args.slice(1)); },
        config: async () => { const fn = await getCommand("config"); await fn(args.slice(1)); },
        init: async () => { const fn = await getCommand("init"); await fn(args.slice(1)); },
        doctor: async () => { const fn = await getCommand("doctor"); await fn(args.slice(1)); },
    };
    const run = commands[cmd];
    if (!run) {
        console.error(`Unknown command: ${cmd}`);
        process.exit(1);
    }
    try {
        await run();
    }
    catch (e) {
        console.error("Error:", e.message);
        process.exit(1);
    }
};
main();

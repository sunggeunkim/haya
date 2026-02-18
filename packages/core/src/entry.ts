#!/usr/bin/env node

import { Command } from "commander";

const program = new Command();

program
  .name("haya")
  .description("Haya — Personal AI assistant gateway")
  .version("0.1.0");

program
  .command("start")
  .description("Start the gateway server")
  .action(() => {
    console.log("Gateway server not yet implemented.");
  });

program.parse();

import * as crypto from "node:crypto";
import * as readline from "node:readline/promises";
import { initializeConfig } from "../config/loader.js";

const DEFAULT_PORT = 18789;

const PROVIDER_KEY_DEFAULTS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  custom: "API_KEY",
};

const DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-20250514",
  bedrock: "anthropic.claude-sonnet-4-20250514-v1:0",
};

/**
 * Run the interactive onboarding wizard.
 * Walks the user through setting up a haya.json config file.
 */
export async function runOnboardWizard(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const handleClose = (): void => {
    rl.close();
    process.stdout.write("\nAborted.\n");
  };

  rl.on("SIGINT", handleClose);

  try {
    process.stdout.write("\n");
    process.stdout.write("========================================\n");
    process.stdout.write("  Welcome to Haya - AI Gateway Setup\n");
    process.stdout.write("========================================\n");
    process.stdout.write("\n");
    process.stdout.write(
      "This wizard will help you create a haya.json configuration file.\n",
    );
    process.stdout.write("\n");

    // Step 1: AI provider
    const provider = await askChoice(
      rl,
      "Select your AI provider (openai / anthropic / bedrock / custom)",
      ["openai", "anthropic", "bedrock", "custom"],
      "openai",
    );

    // Step 2: Provider-specific config
    let apiKeyVar: string | undefined;
    let awsRegion: string | undefined;
    let model: string | undefined;

    if (provider === "bedrock") {
      // Bedrock uses AWS credential chain, no API key needed
      awsRegion = await askString(
        rl,
        "AWS region [us-east-1]",
        "us-east-1",
      );
      const defaultModel = DEFAULT_MODELS.bedrock!;
      model = await askString(
        rl,
        `Bedrock model ID [${defaultModel}]`,
        defaultModel,
      );
      process.stdout.write(
        "\nBedrock uses the AWS credential chain (env vars, ~/.aws/credentials, IAM roles).\n",
      );
    } else {
      const defaultKeyVar = PROVIDER_KEY_DEFAULTS[provider] ?? "API_KEY";
      apiKeyVar = await askString(
        rl,
        `API key environment variable name [${defaultKeyVar}]`,
        defaultKeyVar,
      );
    }

    // Step 3: Gateway port
    const portStr = await askString(
      rl,
      `Gateway port [${DEFAULT_PORT}]`,
      String(DEFAULT_PORT),
    );
    const port = parseInt(portStr, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid port number: ${portStr}`);
    }

    // Step 4: Auth mode
    const authMode = await askChoice(
      rl,
      "Auth mode (token / password)",
      ["token", "password"],
      "token",
    );

    let authSecret: string;
    if (authMode === "token") {
      authSecret = crypto.randomBytes(32).toString("hex");
      process.stdout.write(`\nGenerated auth token: ${authSecret}\n`);
      process.stdout.write(
        "Save this token securely -- it will not be shown again.\n",
      );
    } else {
      authSecret = await askString(rl, "Enter a password for gateway auth", "");
      if (!authSecret) {
        throw new Error("Password cannot be empty");
      }
    }

    // Step 5: Write config
    process.stdout.write("\nWriting haya.json...\n");

    const { generatedToken } = await initializeConfig(
      "haya.json",
      apiKeyVar ?? "OPENAI_API_KEY",
    );

    process.stdout.write("\n");
    process.stdout.write("Setup complete!\n");
    process.stdout.write("\n");
    process.stdout.write("Next steps:\n");
    if (provider === "bedrock") {
      process.stdout.write(
        "  1. Set AWS credentials: export AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...\n",
      );
    } else {
      process.stdout.write(`  1. Set your API key:  export ${apiKeyVar}=<your-key>\n`);
    }
    process.stdout.write(`  2. Start the gateway: npx haya start\n`);
    process.stdout.write(`  3. Run diagnostics:   npx haya doctor\n`);
    process.stdout.write("\n");
  } finally {
    rl.close();
  }
}

async function askString(
  rl: readline.Interface,
  prompt: string,
  defaultValue: string,
): Promise<string> {
  const answer = await rl.question(`${prompt}: `);
  const trimmed = answer.trim();
  return trimmed || defaultValue;
}

async function askChoice(
  rl: readline.Interface,
  prompt: string,
  choices: string[],
  defaultChoice: string,
): Promise<string> {
  const answer = await rl.question(`${prompt}: `);
  const trimmed = answer.trim().toLowerCase();
  if (!trimmed) return defaultChoice;
  if (choices.includes(trimmed)) return trimmed;
  process.stdout.write(
    `Invalid choice "${trimmed}". Using default: ${defaultChoice}\n`,
  );
  return defaultChoice;
}

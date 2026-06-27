# Quick Start — capman-studio

**You do not need to be a developer to follow this guide.**  
Every step is explained. Every command is copy-paste ready.  
If you get stuck, jump to [Section 7 — When something goes wrong](#7-when-something-goes-wrong).

---

## 1. What is this?

Imagine you are building an app — maybe a shopping site, a support tool, or an internal dashboard. You want an AI assistant like Claude to be able to *use* that app — look up orders, check inventory, navigate to pages.

For the AI to do that reliably, it needs a **map** of what your app can do. That map is called a **capability manifest**. It tells the AI: "here are the things this app knows how to do, here is how to ask for them, and here is what you are and are not allowed to do."

**capman** is the tool that creates and manages that map.  
**capman-studio** is the tool that helps *you* inspect, test, and maintain it — so you can trust what the AI does with your app.

Think of it like this:
- **capman** = the engine under the hood
- **capman-studio** = the dashboard on your car

---

## 2. What you need before starting

Go through this checklist before anything else. Every item must be ✅ before you continue.

**✅ A computer running macOS, Windows, or Linux**

**✅ Node.js installed (version 18 or newer)**  
Not sure if you have it? Open your terminal (see note below) and type:
```bash
node --version
```
If you see something like `v20.11.0` you are good. If you see an error, download Node.js from [nodejs.org](https://nodejs.org) — click the big green "LTS" button.

> 💡 **What is a terminal?**  
> On a Mac: press `Cmd + Space`, type `Terminal`, press Enter.  
> On Windows: press the Windows key, type `cmd`, press Enter.  
> On Linux: you already know what a terminal is.

**✅ pnpm installed**  
```bash
npm install -g pnpm
```

**✅ capman installed globally**  
```bash
pnpm add -g capman
```
Check it worked:
```bash
capman --help
```
You should see a list of commands.

**✅ capman-studio installed**  
```bash
git clone <your-repo-url>    ← CHANGE THIS to the actual repo URL
cd capman-studio
pnpm install
```

---

## 3. Try it in 2 minutes

No configuration needed. This uses a demo manifest that comes with capman.

**Step 1 — Generate a demo manifest**

```bash
capman init
capman generate
```

You should see a file called `manifest.json` appear in your folder.

**Step 2 — Inspect it**

```bash
node bin/studio.js eval
```

You will see something like this:

```
  capman-studio  v0.1.0
  ─────────────────────────────────────────

  my-app  v1.0.0 · generated 2026-05-01 10:30

  4 capabilities  ·  3 api / 1 nav  ·  4 public

  ✓  Manifest valid

  CAPABILITIES

  check_product_availability  api  public  2 ex
                              Check if a product is in stock

  get_order_status            api  public  1 ex
                              Get the status of an order
  ...
```

That is your manifest health summary. It tells you what capabilities exist, whether they are valid, and whether they have enough examples for the AI to find them reliably.

**Step 3 — Try a query**

```bash
node bin/studio.js eval --mode=repl
```

Now type a natural language query — the kind of thing a user might say to Claude:

```
  ▶  is the blue jacket in stock?
```

You will see which capability matched, how confident the match was, and what action would have been taken.

Press `Ctrl+C` to exit.

🎉 **That's it.** You have just inspected a manifest and tested a query in under 2 minutes.

---

## 4. Connect it to Claude Desktop

> 💡 **What is Claude Desktop?**  
> It is the desktop app from Anthropic that lets you talk to Claude. You can download it from [claude.ai/download](https://claude.ai/download).

To let Claude use your app's manifest, you need **capman-mcp** — a bridge that connects Claude Desktop to capman.

**Step 1 — Install capman-mcp**

```bash
pnpm add -g capman-mcp
```

**Step 2 — Find your Claude Desktop config file**

On Mac:
```bash
open ~/Library/Application\ Support/Claude/
```

On Windows:
```
C:\Users\YOUR-NAME\AppData\Roaming\Claude\    ← CHANGE YOUR-NAME
```

You are looking for a file called `claude_desktop_config.json`.

**Step 3 — Add capman-mcp to the config**

Open `claude_desktop_config.json` in any text editor (Notepad, TextEdit, VS Code). Add this inside it:

```json
{
  "mcpServers": {
    "capman": {
      "command": "capman-mcp",
      "args": ["--manifest", "/full/path/to/your/manifest.json"]
    }
  }
}
```

> ⚠️ Replace `/full/path/to/your/manifest.json` with the actual path to your `manifest.json` file.  
> On Mac, right-click the file and hold `Option` — you will see "Copy as Pathname".  
> On Windows, hold `Shift` and right-click the file — choose "Copy as path".

**Step 4 — Restart Claude Desktop**

Quit and reopen Claude Desktop. You should see a small plug icon 🔌 at the bottom of the chat input — that means capman-mcp is connected.

**Step 5 — Test it**

Type to Claude:

```
What can you do with this app?
```

Claude should respond by listing the capabilities from your manifest.

---

## 5. Use it with your own app

This section is for when you are ready to connect capman to a real app — not just the demo.

**Step 1 — Create a config file**

In your project folder, run:

```bash
capman init
```

This creates a file called `capman.config.js`. Open it — it looks like this:

```js
module.exports = {
  app: 'my-app',       ← CHANGE THIS to your app's name
  version: '1.0.0',
  capabilities: [
    // your capabilities go here
  ]
}
```

**Step 2 — Describe what your app can do**

Each capability is one thing your app knows how to do. Here is an example:

```js
{
  id: 'check_order_status',
  name: 'Check Order Status',
  description: 'Look up the current status of a customer order by order ID',
  examples: [
    'what is the status of order 1234?',
    'has my order shipped yet?',
    'where is my package?'
  ],
  resolver: {
    type: 'api',
    endpoint: 'GET /api/orders/{orderId}/status'
  },
  privacy: {
    level: 'user_owned'
  }
}
```

> 💡 **The `examples` field is the most important thing to get right.**  
> These are the phrases the AI uses to recognise when a user wants this capability.  
> Write them the way a real user would speak, not the way a developer would.

**Step 3 — Generate the manifest**

```bash
capman generate
```

**Step 4 — Check it looks right**

```bash
node bin/studio.js eval
```

If you see warnings like `no examples — keyword matching may be weak`, go back and add more examples to that capability.

**Step 5 — Run a test suite**

Generate a starter test file:

```bash
node bin/studio.js generate-suite
```

This creates `eval-suite.json` — a list of test queries, one per capability. Open it and edit the queries to match what real users would actually say.

Then run the suite:

```bash
node bin/studio.js eval --mode=suite --suite eval-suite.json
```

You will see a pass/fail report. Aim for 80%+ before going live.

---

## 6. What to say to Claude

Once Claude Desktop is connected to your manifest, here are example prompts that work well:

**To explore what the app can do:**
```
What can you help me with in this app?
```

**To test a specific capability:**
```
Check if product SKU-12345 is in stock
```

**To trigger a navigation:**
```
Take me to the checkout page
```

**To look up data:**
```
What is the status of order 98765?
```

**To test the limits (important!):**
```
Delete all orders from last month
```

> 💡 This last one should be blocked if `privacy.level` is set correctly. If it is not blocked, go back and check your capability's privacy settings.

**Prompts that help you debug:**
```
What capability would you use to check inventory?
How confident are you that this matches "show me the cart"?
```

---

## 7. When something goes wrong

### ❌ `capman: command not found`

capman is not installed or not on your PATH.

**Fix:**
```bash
pnpm add -g capman
```

Then close and reopen your terminal.

---

### ❌ `Manifest file not found`

capman-studio cannot find `manifest.json`.

**Fix:** Make sure you are in the right folder (the one that contains `manifest.json`) before running commands:
```bash
ls manifest.json
```
If you do not see it, run `capman generate` first.

---

### ❌ `Manifest is not valid JSON`

Your `manifest.json` file is broken.

**Fix:** Run capman's own validator:
```bash
capman validate
```
It will tell you exactly what is wrong.

---

### ❌ Claude says "I don't know how to do that" for something in your manifest

The AI could not match the query to a capability. This usually means the `examples` field needs more variety.

**Fix:** Open `capman.config.js`, find the relevant capability, and add more examples — especially variations on how users might phrase the request. Then run `capman generate` and test again with:
```bash
node bin/studio.js eval --mode=repl
```

---

### ❌ The plug icon 🔌 does not appear in Claude Desktop

capman-mcp is not connecting.

**Fix:**
1. Make sure `capman-mcp` is installed: `pnpm add -g capman-mcp`
2. Check your `claude_desktop_config.json` has no typos — JSON is strict about commas and quotes
3. Make sure the path to `manifest.json` in the config file is the full absolute path (not a relative path like `./manifest.json`)
4. Fully quit and reopen Claude Desktop (not just close the window)

---

## 8. Glossary

Ten terms you will encounter — explained without jargon.

| Term | What it means |
|---|---|
| **Manifest** | A JSON file that lists everything your app can do, in a format the AI understands. Think of it as a menu of actions. |
| **Capability** | One item on that menu — one thing your app can do. "Check order status" is a capability. "Navigate to checkout" is a capability. |
| **capman** | The library that creates manifests and matches user intent to the right capability. |
| **capman-studio** | This tool. The developer dashboard that lets you inspect, test, and validate manifests. |
| **capman-mcp** | The bridge that connects Claude Desktop to your manifest. MCP stands for Model Context Protocol — the standard Claude uses to talk to external tools. |
| **Resolver** | The part of a capability that says *how* to execute it — either by calling an API endpoint or by navigating to a screen. |
| **Privacy level** | Controls who can use a capability. `public` = anyone. `user_owned` = only the logged-in user's own data. `admin` = only admins. |
| **Eval suite** | A JSON file of test queries — one per capability — used to verify the manifest is working correctly. |
| **Pass rate** | The percentage of test queries that matched the expected capability. 80%+ is the recommended target before going live. |
| **Threshold** | A minimum pass rate requirement. If the pass rate drops below the threshold, the CI pipeline fails. |
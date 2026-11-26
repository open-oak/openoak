import { suiteUrls } from "../../../../shared/suite-config";
import { CopyButton } from "./ai-tabs";
import styles from "./page.module.css";

export function SetupInstructions() {
  const address = suiteUrls().mcp;
  return (
      <section className={styles.setup} aria-labelledby="setup-title">
        <h2 id="setup-title">One address for your OpenOak apps</h2>
        <p className={styles.muted}>Add this server in your AI app, then sign in to OpenOak and review its access.</p>
        <div className={styles.copyRow}>
          <code>{address}</code>
          <CopyButton value={address} label="Copy address" />
        </div>
        <p className={styles.accessNote}>Connects OpenTodo, OpenOutline and OpenKanban. Read and write access is requested by default.</p>

        <div aria-labelledby="clients-title">
          <h3 id="clients-title">Choose your AI app for instructions</h3>
          <details name="client"><summary>Codex</summary><div className={styles.guide}>
            <p>In the terminal, add OpenOak and sign in:</p>
            <pre><code>{`codex mcp add openoak --url ${address}\ncodex mcp login openoak`}</code></pre>
            <a href="https://learn.chatgpt.com/docs/extend/mcp?surface=cli">Codex setup guide</a>
          </div></details>
          <details name="client"><summary>ChatGPT</summary><div className={styles.guide}>
            <p>In Settings, open Apps, choose Create and use the server address above with OAuth authentication. Sign in to OpenOak when prompted.</p>
            <p>You may need developer mode in Apps, under Advanced settings. Availability depends on your account and workspace settings.</p>
            <a href="https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt-beta">ChatGPT setup guide</a>
          </div></details>
          <details name="client"><summary>Claude Code</summary><div className={styles.guide}>
            <p>Add OpenOak in the terminal, then use <code>/mcp</code> in Claude Code to sign in:</p>
            <pre><code>{`claude mcp add --transport http openoak ${address}`}</code></pre>
            <a href="https://code.claude.com/docs/en/mcp">Claude Code setup guide</a>
          </div></details>
          <details name="client"><summary>VS Code</summary><div className={styles.guide}>
            <p>Open the Command Palette and run <strong>MCP: Add Server</strong>. Choose HTTP, paste the server address and name it OpenOak. Follow the sign-in prompt.</p>
            <a href="https://code.visualstudio.com/docs/agent-customization/mcp-servers">VS Code setup guide</a>
          </div></details>
          <details name="client"><summary>Cursor</summary><div className={styles.guide}>
            <p>Add OpenOak as a remote MCP server using the address above, then sign in when prompted.</p>
            <a href="https://cursor.com/docs/mcp">Cursor setup guide</a>
          </div></details>
        </div>
        <details className={styles.check}><summary>Try your connection</summary><div className={styles.guide}>
          <p>Open a new conversation and ask:</p>
          <div className={styles.copyRow}><code>Check my OpenOak connection.</code><CopyButton value="Check my OpenOak connection." label="Copy prompt" /></div>
        </div></details>
      </section>
  );
}

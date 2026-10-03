import { useState } from "react";
import { SERVICE_DESIGN } from "./TelegramExperience";
import "./telegramExperience.css";

const BOT_URL = "https://t.me/pulsemi_bot";
const SERVICE_COMMANDS: Record<string, string> = {
  "global-quick": "/globalquick", "global-pro": "/globalpro", "risk-guard": "/risk",
  "prediction-quick": "/predictionquick", "prediction-pro": "/predictionpro",
};

export function TelegramGuide() {
  const [copyNotice, setCopyNotice] = useState("");
  const copyCommand = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopyNotice(`Copied ${command}. Paste it into PULSE chat.`);
    } catch {
      setCopyNotice(`Copy ${command} manually and paste it into PULSE chat.`);
    }
  };
  const commandButton = (command: string) => (
    <button type="button" className="tg-guide-copy" onClick={() => void copyCommand(command)} aria-label={`Copy ${command}`}>
      <code>{command}</code><span>{copyNotice.startsWith(`Copied ${command}.`) ? "Copied" : "Copy"}</span>
    </button>
  );

  return <div className="tg-guide">
    <header className="tg-guide-header">
      <div>
        <span className="tg-guide-eyebrow">TELEGRAM · GETTING STARTED</span>
        <h1>Use PULSE in Telegram.</h1>
        <p>Start the bot, buy research with Stars, and bring your existing PULSE report history into the same Telegram account.</p>
        <div className="tg-guide-actions">
          <a className="tg-guide-action primary" href={`${BOT_URL}?start=pulse`} target="_blank" rel="noreferrer">Open PULSE bot <span>↗</span></a>
          <a className="tg-guide-action" href={`${BOT_URL}?startapp`} target="_blank" rel="noreferrer">Open TON Mini App <span>↗</span></a>
        </div>
        <p className="tg-guide-handle">One bot: <a href={BOT_URL} target="_blank" rel="noreferrer">@pulsemi_bot</a>. Use your own Telegram account.</p>
      </div>
      <aside className="tg-guide-account" aria-label="Your PULSE Telegram account">
        <span className="tg-guide-eyebrow">YOUR ACCOUNT & WALLETS</span><h2>What connects to what?</h2>
        <p><b>Telegram account</b><span>Owns your Stars purchases and saved reports.</span></p>
        <p><b>EVM history wallet</b><span>Link once in chat to read retained website reports.</span></p>
        <p><b>TON wallet</b><span>Optional TON Connect session inside the Mini App.</span></p>
      </aside>
    </header>
    <nav className="tg-guide-nav" aria-label="Telegram guide sections">
      <a href="#tg-guide-start">Start & buy</a><a href="#tg-guide-services">Services & inputs</a>
      <a href="#tg-guide-history">Link history wallet</a><a href="#tg-guide-ton">TON Mini App</a><a href="#tg-guide-recovery">Reports & help</a>
    </nav>

    <section className="tg-guide-section" id="tg-guide-start" aria-labelledby="tg-guide-start-title">
      <div className="tg-guide-section-title"><span>01 / YOUR FIRST REPORT</span><h2 id="tg-guide-start-title">From Start to your report.</h2><p>You can buy with Stars without connecting a wallet. Opening the bot or selecting a service is free.</p></div>
      <ol className="tg-guide-start-steps">
        <li><span>1</span><h3>Open the bot</h3><p>Open <b>@pulsemi_bot</b> and press <b>Start</b>. Already started? Send <code>/start</code> to show the menu again.</p></li>
        <li><span>2</span><h3>Choose & send input</h3><p>Choose one of the five services. Send the pair and timeframe, token contract, or exact prediction market ID requested by the bot.</p></li>
        <li><span>3</span><h3>Review & pay Stars</h3><p>Select <b>Review Stars checkout</b>, check the service and price, then open <b>Pay</b> and confirm the Telegram invoice.</p></li>
        <li><span>4</span><h3>Read in chat</h3><p>PULSE sends a summary and the complete report as a text document. Use <b>My reports</b> or <code>/reports</code> to recover it later.</p></li>
      </ol>
    </section>

    <section className="tg-guide-section" id="tg-guide-services" aria-labelledby="tg-guide-services-title">
      <div className="tg-guide-section-title"><span>02 / CHOOSE YOUR RESEARCH</span><h2 id="tg-guide-services-title">What to send to the bot.</h2><p>Send the service command first, wait for its prompt, then send the research input as a separate message.</p></div>
      <ul className="tg-guide-services">{SERVICE_DESIGN.map(service => <li className="tg-guide-service" key={service.id}>
        <div className="tg-guide-service-name"><span className="tg-guide-tier">{service.tier}</span><h3>{service.title}</h3>{commandButton(SERVICE_COMMANDS[service.id])}</div>
        <div className="tg-guide-service-input"><b>{service.kind === "global" ? "Pair + timeframe" : service.kind === "risk" ? "Network + token contract" : "Exact supported market ID"}</b>
          <p>{service.kind === "global" ? <>For example, <code>BTC-USDT 4H</code>. Use a supported pair and timeframe.</> : service.kind === "risk" ? <>Send <code>xlayer</code>, <code>base</code>, <code>arbitrum</code> or <code>robinhood</code>, a space, and the full <code>0x…</code> token contract address.</> : <>Paste the supported market ID exactly, keeping its letter case. A market title or URL is not accepted.</>}</p>
        </div>
        <strong className="tg-guide-price">{service.stars}<span>Stars / report</span></strong>
      </li>)}</ul>
      <p className="tg-guide-note">Choose the service again if its input request expires. Check the invoice before approving: Quick reports cost 10 Stars; Pro reports and Risk Guard cost 15 Stars.</p>
    </section>

    <section className="tg-guide-section" id="tg-guide-history" aria-labelledby="tg-guide-history-title">
      <div className="tg-guide-section-title"><span>03 / EXISTING WEBSITE REPORTS</span><h2 id="tg-guide-history-title">Link your history wallet once.</h2><p>Use the EVM wallet that paid for your reports on the PULSE website or in a mobile wallet browser. Linking makes its retained paid reports readable in Telegram.</p></div>
      <div className="tg-guide-two-column">
        <ol className="tg-guide-detail-steps">
          <li><b>Open Wallet history in chat.</b><p>Send <code>/wallet</code> or select <b>Wallet history</b>, then choose <b>Link history wallet</b>.</p></li>
          <li><b>Verify ownership in your browser.</b><p>Open <b>Verify wallet ownership</b>, connect the correct wallet, and sign the displayed ownership message. You do not send a transaction or switch networks. The link expires after 10 minutes.</p></li>
          <li><b>Return to PULSE chat and confirm.</b><p>Select <b>Review signed wallet</b>, check the complete address, then select <b>Confirm this wallet</b>. Signing in the browser alone does not save the association.</p></li>
          <li><b>Open My reports.</b><p>Your retained wallet-paid reports appear alongside your Telegram purchases. Future history reads need no new signature, transaction or chain selection.</p></li>
        </ol>
        <aside className="tg-guide-callout"><span className="tg-guide-eyebrow">SAVED TO YOUR TELEGRAM ACCOUNT</span><h3>Your saved wallet stays linked.</h3>
          <p>Closing Telegram, disconnecting the browser wallet, or moving to another device keeps the association with your Telegram account.</p>
          <p>To replace it, use <code>/wallet</code> → <b>Change history wallet</b> and confirm the new address. The current wallet stays linked until you confirm its replacement.</p>
          <p>To remove it, select <b>Unlink history wallet</b>, then <b>Confirm unlink</b>. Your Telegram Stars purchases remain available.</p>
        </aside>
      </div>
    </section>

    <section className="tg-guide-section" id="tg-guide-ton" aria-labelledby="tg-guide-ton-title">
      <div className="tg-guide-section-title"><span>04 / THE SAME BOT'S MINI APP</span><h2 id="tg-guide-ton-title">Open TON research. Connect a TON wallet.</h2><p>The TON Mini App lives inside @pulsemi_bot. It offers TON-USDT Global Quick for 10 Stars and Global Pro for 15 Stars.</p></div>
      <div className="tg-guide-two-column">
        <ol className="tg-guide-detail-steps">
          <li><b>Launch from Telegram.</b><p>Send <code>/miniapp</code> in PULSE chat and select <b>Open PULSE Mini App</b>, or use the bot's Mini App menu button.</p></li>
          <li><b>Connect a TON wallet if you want to.</b><p>Open the Mini App's <b>TON wallet</b> tab, select <b>Connect wallet</b>, choose a TON wallet and approve the connection in that wallet. Return to the Mini App to see the connected address.</p></li>
          <li><b>Choose research and review checkout.</b><p>In <b>Explore</b>, choose Global Quick or Pro and a timeframe. Allow PULSE to send messages when prompted, then review and confirm the Stars invoice.</p></li>
          <li><b>Recover the result from either place.</b><p>Read TON purchases in the Mini App's <b>Reports</b> tab or in PULSE chat's <b>My reports</b>. The complete report document is delivered to the chat too.</p></li>
        </ol>
        <aside className="tg-guide-callout"><span className="tg-guide-eyebrow">OPTIONAL WALLET CONNECTION</span><h3>Stars pay for your research.</h3>
          <p>A TON wallet connection is optional. Connecting it does not pay an invoice or authorize a trade.</p>
          <p>TON Connect manages this wallet session. Your reports belong to your Telegram account and remain available if you disconnect the TON session.</p>
          <p>Your saved EVM history wallet is managed in chat. Connecting or disconnecting TON does not change it.</p>
          <a className="tg-guide-action" href={`${BOT_URL}?startapp`} target="_blank" rel="noreferrer">Open TON Mini App ↗</a>
        </aside>
      </div>
    </section>

    <section className="tg-guide-section" id="tg-guide-recovery" aria-labelledby="tg-guide-recovery-title">
      <div className="tg-guide-section-title"><span>05 / KEEP YOUR REPORTS CLOSE</span><h2 id="tg-guide-recovery-title">Recovery and connection help.</h2><p>Sign in to the same Telegram account on your next device and open PULSE. Your Stars purchases follow that account.</p></div>
      <div className="tg-guide-help">
        <details><summary>Paid, but the report has not arrived?</summary><p>Open <code>/reports</code>, select the order and check its status. Use <b>Refresh order</b> while it is processing. Do not buy again to recover a paid order. If the report fails and offers <b>Refund failed report</b>, use that button. For other payment issues, send <code>/paysupport</code> and include the order ID.</p></details>
        <details><summary>Linked wallet history is missing?</summary><p>Send <code>/wallet</code> and check the saved address against the wallet used for your website purchase. If you only signed in the browser, return to chat and complete <b>Review signed wallet</b> → <b>Confirm this wallet</b>. If the proof link expired, start again from <code>/wallet</code>. Only retained paid reports for the confirmed wallet appear.</p></details>
        <details><summary>The Mini App shows Browser preview or unavailable checkout?</summary><p>Open it through <code>/miniapp</code> in PULSE chat so Telegram supplies your signed account identity. A regular browser preview cannot buy or load private reports. If checkout remains paused, follow the bot's availability message and use <code>/paysupport</code>.</p></details>
        <details><summary>Changing wallets or Telegram accounts?</summary><p>Changing the saved EVM wallet requires explicit confirmation in chat. Disconnecting a browser or TON session keeps report access. A different Telegram account has its own Stars purchases; use the original purchasing account to recover those orders.</p></details>
      </div>
    </section>

    <section className="tg-guide-section tg-guide-shortcuts" aria-labelledby="tg-guide-shortcuts-title">
      <div className="tg-guide-section-title"><span>06 / USEFUL COMMANDS</span><h2 id="tg-guide-shortcuts-title">Keep these handy.</h2></div>
      <div className="tg-guide-command-grid">{[["/help", "Bot instructions"], ["/reports", "Your paid reports"], ["/wallet", "Saved EVM history wallet"], ["/miniapp", "TON research & TON Connect"], ["/paysupport", "Payment recovery & help"], ["/website", "The full PULSE website"]].map(([command, description]) => <div key={command}>{commandButton(command)}<p>{description}</p></div>)}</div>
      <p role="status" className="tg-guide-copy-notice" aria-live="polite">{copyNotice}</p>
      <p className="tg-guide-note">Explore the full platform at <a href="https://www.ai-pulse.tech" target="_blank" rel="noreferrer">www.ai-pulse.tech ↗</a>. Research purchases do not authorize trades.</p>
    </section>
  </div>;
}

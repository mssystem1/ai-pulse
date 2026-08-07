export function Tip({ text }: { text: string }) {
  return <span className="tip" tabIndex={0} data-tip={text} aria-label={text}>?</span>;
}

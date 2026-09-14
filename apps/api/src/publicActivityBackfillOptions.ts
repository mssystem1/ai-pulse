/** Explicit namespace allowlists: no wildcard scans or implicit production writes. */
export function parseBackfillOptions(args: string[], currentNamespace: string) {
  const namespace = (value: string | undefined) => {
    if (!value || !/^[a-zA-Z0-9:_-]{1,64}$/.test(value) || value.startsWith('--')) throw new Error('A literal persistence namespace is required');
    return value;
  };
  let write = false, targetNamespace = namespace(currentNamespace), targetExplicit = false;
  const sources: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--write') write = true;
    else if (args[i] === '--source-namespace') sources.push(namespace(args[++i]));
    else if (args[i] === '--target-namespace') { targetNamespace = namespace(args[++i]); targetExplicit = true; }
    else throw new Error('Usage: publicActivityBackfill.ts [--write] [--source-namespace NAME ...] [--target-namespace NAME]');
  }
  const sourceNamespaces = [...new Set(sources.length ? sources : [namespace(currentNamespace)])];
  if (write && sources.length && !targetExplicit) throw new Error('Cross-namespace publication requires --target-namespace');
  return { write, targetNamespace, sourceNamespaces };
}

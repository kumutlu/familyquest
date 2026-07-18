import { pathToFileURL } from 'node:url'
import { formatResetReport, parseResetArgs, runFamilyReset } from './lib/family-data-tools'
import { createFirebaseAdminStore, LocalJsonWriter } from './lib/firebase-admin-data-tools'

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseResetArgs(argv)
  const result = await runFamilyReset(
    createFirebaseAdminStore(args.projectId),
    new LocalJsonWriter(),
    { ...args, outputDirectory: 'family-data-exports', now: new Date() },
  )

  console.log(`Family reset ${result.executed ? 'executed' : 'dry-run'} for ${args.familyId} in ${args.projectId}`)
  console.log(formatResetReport(result))
  console.log(`wallets: ${result.walletResetCount} balance(s) to reset`)
  console.log(`child profiles: ${result.childProfileResetCount} operational balance/counter record(s) to reset`)
  if (result.backupPath) console.log(`Pre-reset backup: ${result.backupPath}`)
  if (!result.executed) console.log('No data was changed. Re-run with --execute only after reviewing this plan.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}

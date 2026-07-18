import { pathToFileURL } from 'node:url'
import { exportFamilyData, parseExportArgs } from './lib/family-data-tools'
import { createFirebaseAdminStore, LocalJsonWriter } from './lib/firebase-admin-data-tools'

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseExportArgs(argv)
  const result = await exportFamilyData(
    createFirebaseAdminStore(options.projectId),
    new LocalJsonWriter(),
    { ...options, now: new Date() },
  )
  console.log(`Exported ${result.documentCount} documents to ${result.outputPath}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}

import { join } from 'node:path'

export function resolveDataRoot(options: {
  isPackaged: boolean
  userDataPath: string
}): string {
  if (process.env.ZYAPP_DATA_DIR) {
    return process.env.ZYAPP_DATA_DIR
  }

  if (!options.isPackaged) {
    return join(options.userDataPath, 'dev-data')
  }

  const programData = process.env.ProgramData
  if (!programData) {
    throw new Error('Windows ProgramData directory is unavailable')
  }

  return join(programData, 'ZyApp')
}

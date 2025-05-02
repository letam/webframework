export const SERVER_HOST: string = (import.meta.env.VITE_SERVER_HOST as string) || ''

export const SERVER_API_URL = `${SERVER_HOST}/api`

export const UPLOAD_FILES_TO_S3 = import.meta.env.VITE_UPLOAD_FILES_TO_S3 === 'true'

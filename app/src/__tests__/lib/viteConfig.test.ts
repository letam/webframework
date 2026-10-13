import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadConfigFromFile, type ProxyOptions } from 'vite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const configFile = path.resolve(import.meta.dirname, '../../../vite.config.ts')
let envDirectory: string

beforeEach(() => {
	envDirectory = mkdtempSync(path.join(tmpdir(), 'practice-vite-env-'))
	vi.spyOn(process, 'cwd').mockReturnValue(envDirectory)
	vi.stubEnv('VITE_WS_PROXY_TARGET', undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
	rmSync(envDirectory, { recursive: true, force: true })
})

async function proxyConfig(mode: string) {
	const loaded = await loadConfigFromFile({ command: 'serve', mode }, configFile, envDirectory)
	if (!loaded?.config.server?.proxy) throw new Error('Expected backend proxies')
	return loaded.config.server.proxy as Record<string, ProxyOptions>
}

function expectTargets(proxy: Record<string, ProxyOptions>, target: string) {
	for (const route of ['/auth/', '/api/', '/p/', '/media/', '/ws/']) {
		expect(proxy[route].target).toBe(target)
		expect(proxy[route].changeOrigin).not.toBe(true)
	}
	expect(proxy['/ws/'].ws).toBe(true)
}

describe('Vite same-origin backend proxy configuration', () => {
	it('loads the active mode local file and applies it to HTTP and socket routes', async () => {
		writeFileSync(path.join(envDirectory, '.env'), 'VITE_WS_PROXY_TARGET=http://127.0.0.1:8100')
		writeFileSync(
			path.join(envDirectory, '.env.development.local'),
			'VITE_WS_PROXY_TARGET=http://127.0.0.1:8200'
		)
		writeFileSync(
			path.join(envDirectory, '.env.production.local'),
			'VITE_WS_PROXY_TARGET=http://127.0.0.1:8300'
		)
		expectTargets(await proxyConfig('development'), 'http://127.0.0.1:8200')
		expectTargets(await proxyConfig('production'), 'http://127.0.0.1:8300')
	})

	it('keeps an explicit shell override ahead of the mode file', async () => {
		writeFileSync(
			path.join(envDirectory, '.env.development.local'),
			'VITE_WS_PROXY_TARGET=http://127.0.0.1:8200'
		)
		vi.stubEnv('VITE_WS_PROXY_TARGET', 'http://127.0.0.1:8400')
		expectTargets(await proxyConfig('development'), 'http://127.0.0.1:8400')
	})

	it('uses the loopback backend default when no override is configured', async () => {
		expectTargets(await proxyConfig('development'), 'http://127.0.0.1:8000')
	})
})

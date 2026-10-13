import { expect, test } from '@playwright/test'

const enabled = process.env.PRACTICE_E2E === '1'
const rules = JSON.stringify(['no-hate', 'be-respectful', 'safe-environment', 'be-awesome'])

async function signUp(page: import('@playwright/test').Page, prefix: string) {
	const username = `${prefix}${Math.random().toString(36).slice(2, 10)}`
	await page
		.getByRole('button', { name: /sign up/i })
		.first()
		.click()
	await page
		.getByRole('dialog')
		.getByLabel(/^username$/i)
		.fill(username)
	await page
		.getByRole('dialog')
		.getByLabel(/^password$/i)
		.fill('PracticeTestPass123!')
	await page
		.getByRole('dialog')
		.getByLabel(/confirm password/i)
		.fill('PracticeTestPass123!')
	await page
		.getByRole('dialog')
		.getByRole('button', { name: /create account/i })
		.click()
	await expect(page.getByRole('dialog')).toBeHidden()
	return username
}

test('two signed-in members share and recover a host-controlled timer', async ({
	browser,
	baseURL,
}) => {
	test.skip(!enabled, 'Run with PRACTICE_E2E=1 against a practice-enabled backend.')
	const hostContext = await browser.newContext()
	const guestContext = await browser.newContext()
	await hostContext.addInitScript((accepted) => {
		localStorage.setItem('ground-rules-accepted', accepted)
		const realNow = Date.now.bind(Date)
		Date.now = () => realNow() + 300_000
	}, rules)
	await guestContext.addInitScript((accepted) => {
		localStorage.setItem('ground-rules-accepted', accepted)
		const realNow = Date.now.bind(Date)
		Date.now = () => realNow() - 300_000
	}, rules)
	const host = await hostContext.newPage()
	const guest = await guestContext.newPage()
	try {
		await host.goto(`${baseURL}/practice`)
		await signUp(host, 'practicehost')
		await host.getByLabel('Room title').fill('Morning session')
		await host.getByLabel('Duration (minutes)').fill('2')
		await host.getByRole('button', { name: 'Create room' }).click()
		await expect(host.getByRole('heading', { name: 'Morning session' })).toBeVisible()
		await expect(host.getByText('Connected · timer confirmed')).toBeVisible()
		const invite = await host.getByLabel('Invitation link').inputValue()
		expect(invite).toContain('#invite=')
		await guest.goto(invite)
		await expect(guest).not.toHaveURL(/#invite=/)
		await signUp(guest, 'practiceguest')
		await guest.getByRole('button', { name: 'Join room' }).click()
		await expect(guest.getByRole('heading', { name: 'Morning session' })).toBeVisible()
		await expect(guest.getByText('Connected · timer confirmed')).toBeVisible()
		await expect(guest.getByRole('button', { name: 'Start' })).toHaveCount(0)
		await host.getByRole('button', { name: 'Start' }).click()
		await expect(host.getByText('running', { exact: true })).toBeVisible()
		await expect(guest.getByText('running', { exact: true })).toBeVisible()
		const [hostMs, guestMs] = await Promise.all([
			host.getByRole('timer').getAttribute('data-remaining-ms'),
			guest.getByRole('timer').getAttribute('data-remaining-ms'),
		])
		const skewMs = Math.abs(Number(hostMs) - Number(guestMs))
		console.info(`Practice timer skew: ${skewMs} ms`)
		expect(skewMs).toBeLessThanOrEqual(250)
		// Reconnect the guest with an added 200 ms server-to-browser delivery delay.
		// This exercises calibration and convergence under asymmetric network jitter.
		await guest.routeWebSocket('**/ws/practice/rooms/**', (socket) => {
			const server = socket.connectToServer()
			server.onMessage((message) => {
				setTimeout(() => socket.send(message), 200)
			})
		})
		await guest.reload()
		await expect(guest.getByText('Connected · timer confirmed')).toBeVisible()
		const [hostJitterMs, guestJitterMs] = await Promise.all([
			host.getByRole('timer').getAttribute('data-remaining-ms'),
			guest.getByRole('timer').getAttribute('data-remaining-ms'),
		])
		const jitterSkewMs = Math.abs(Number(hostJitterMs) - Number(guestJitterMs))
		console.info(`Practice timer skew with 200 ms downlink delay: ${jitterSkewMs} ms`)
		expect(jitterSkewMs).toBeLessThanOrEqual(500)
		await host.getByRole('button', { name: 'Pause' }).click()
		await expect(guest.getByText('paused', { exact: true })).toBeVisible()
		if (process.env.PRACTICE_SCREENSHOT_PATH) {
			await host.screenshot({
				path: process.env.PRACTICE_SCREENSHOT_PATH,
				fullPage: true,
				animations: 'disabled',
			})
		}
		await host.getByRole('button', { name: 'Resume' }).click()
		await expect(guest.getByText('running', { exact: true })).toBeVisible()
		await host.getByLabel('New duration on reset (minutes)').fill('1')
		await host.getByRole('button', { name: 'Reset timer' }).click()
		await expect(guest.getByText('ready', { exact: true })).toBeVisible()
		await expect(guest.getByRole('timer')).toHaveText('01:00')
		await guestContext.setOffline(true)
		await expect(guest.getByText('Connection lost · timer unconfirmed')).toBeVisible()
		await guestContext.setOffline(false)
		await expect(guest.getByText('Connected · timer confirmed')).toBeVisible()
		await guest.getByRole('button', { name: 'Leave room' }).click()
		await expect(guest.getByRole('heading', { name: 'Join practice room' })).toBeVisible()
	} finally {
		await hostContext.close()
		await guestContext.close()
	}
})

import { isDesktop, isFirefox, isIOS, isSafari } from '@/lib/utils/browser'
import { mimeTypes } from '@/lib/utils/media'

const DebugPage = () => {
	const supportedMimeTypes = mimeTypes.filter((type) => MediaRecorder.isTypeSupported(type))

	return (
		<div className="container mx-auto p-8">
			<h1 className="text-2xl font-bold mb-6">Browser Debug Information</h1>

			<div className="space-y-4">
				<div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
					<h2 className="text-lg font-semibold mb-2">Supported Media MIME Types</h2>
					<pre className="whitespace-pre-wrap break-all">
						{JSON.stringify(supportedMimeTypes, null, 2)}
					</pre>
				</div>

				<div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
					<h2 className="text-lg font-semibold mb-2">navigator.userAgentData</h2>
					<pre className="whitespace-pre-wrap break-all">
						{JSON.stringify(navigator.userAgentData, null, 2)}
					</pre>
				</div>

				<div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
					<h2 className="text-lg font-semibold mb-2">navigator.userAgent</h2>
					<pre className="whitespace-pre-wrap break-all">{navigator.userAgent}</pre>
				</div>

				<div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
					<h2 className="text-lg font-semibold mb-2">navigator.platform</h2>
					<pre className="whitespace-pre-wrap break-all">{navigator.platform}</pre>
				</div>

				<div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
					<h2 className="text-lg font-semibold mb-2">isDesktop() Result</h2>
					<pre className="whitespace-pre-wrap">{isDesktop().toString()}</pre>
				</div>

				<div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
					<h2 className="text-lg font-semibold mb-2">isIOS() Result</h2>
					<pre className="whitespace-pre-wrap">{isIOS().toString()}</pre>
				</div>

				<div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
					<h2 className="text-lg font-semibold mb-2">isSafari() Result</h2>
					<pre className="whitespace-pre-wrap">{isSafari().toString()}</pre>
				</div>

				<div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
					<h2 className="text-lg font-semibold mb-2">isFirefox() Result</h2>
					<pre className="whitespace-pre-wrap">{isFirefox().toString()}</pre>
				</div>
			</div>
		</div>
	)
}

export default DebugPage

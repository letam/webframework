import type { ReactElement } from "react";
import { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import createPost from "../api/createPost";

export default function PostForm(): ReactElement {
  const queryClient = useQueryClient();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [form, setForm] = useState({
    head: "",
    body: "",
    audio: null as File | null,
  });

  // Cleanup preview URL when component unmounts or when audio changes
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  function clearAudio() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl('');
    setForm(state => ({ ...state, audio: null }));
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const file = new File([blob], 'recording.webm', { type: 'audio/webm' });
        setForm(state => ({ ...state, audio: file }));

        // Clean up old preview URL and create new one
        if (previewUrl) {
          URL.revokeObjectURL(previewUrl);
        }
        const newPreviewUrl = URL.createObjectURL(blob);
        setPreviewUrl(newPreviewUrl);
      };

      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
    } catch (error) {
      console.error('Error accessing microphone:', error);
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach(track => track.stop());
      setIsRecording(false);
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      setForm(state => ({ ...state, audio: file }));

      // Clean up old preview URL and create new one
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      const newPreviewUrl = URL.createObjectURL(file);
      setPreviewUrl(newPreviewUrl);
    }
  }

  function submitForm(): void {
    // Check if either text or audio is present
    if (form.head.trim() === "" && !form.audio) {
      return;
    }

    const formData = new FormData();
    formData.append('head', form.head);
    formData.append('body', form.body);
    if (form.audio) {
      formData.append('audio', form.audio);
    }

    createPost(formData)
      .then(() => {
        setForm({ head: "", body: "", audio: null }); // Reset form
        if (previewUrl) {
          URL.revokeObjectURL(previewUrl);
          setPreviewUrl('');
        }
        if (fileInputRef.current) {
          fileInputRef.current.value = ''; // Clear file input
        }
        queryClient.invalidateQueries({ queryKey: ["posts"] }); // Trigger posts refetch
        textareaRef.current?.focus(); // Refocus textarea after submission
      })
      .catch((error) => {
        console.error(error);
        // TODO: Display error message to user
      });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    submitForm();
  }

  return (
    <div className="mt-8 max-w-2xl mx-auto px-4">
      <form onSubmit={handleSubmit} role="form" aria-label="Create new post">
        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="head" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              What's on your mind? {!form.audio && <span className="text-red-500">*</span>}
            </label>
            <textarea
              ref={textareaRef}
              className="w-full p-4 border rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100"
              id="head"
              name="head"
              value={form.head}
              onChange={(event) =>
                setForm((state) => ({ ...state, head: event.target.value }))
              }
              onKeyDown={(event) => {
                if (event.code === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  submitForm();
                }
              }}
              placeholder="Share your thoughts... (optional if audio is attached)"
              aria-label="Post content"
              tabIndex={1}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Add audio {!form.head.trim() && <span className="text-red-500">*</span>}
            </label>
            <div className="flex flex-col space-y-2">
              <div className="flex space-x-2">
                <button
                  type="button"
                  onClick={isRecording ? stopRecording : startRecording}
                  className={`px-4 py-2 text-sm font-medium rounded-lg shadow-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 dark:ring-offset-gray-800 ${
                    isRecording
                    ? 'text-white bg-red-600 hover:bg-red-500 focus:ring-red-500 dark:bg-red-500 dark:hover:bg-red-400'
                    : 'text-white bg-blue-600 hover:bg-blue-500 focus:ring-blue-500 dark:bg-blue-500 dark:hover:bg-blue-400'
                  }`}
                >
                  {isRecording ? 'Stop Recording' : 'Start Recording'}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*"
                  onChange={handleFileChange}
                  className="block w-full text-sm text-gray-500 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-900 dark:file:text-blue-300 dark:hover:file:bg-blue-800 file:transition-colors file:duration-200"
                />
                {form.audio && (
                  <button
                    type="button"
                    onClick={clearAudio}
                    className="px-4 py-2 text-sm font-medium rounded-lg shadow-sm text-red-600 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:bg-red-900/50 dark:hover:bg-red-900/75 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 dark:ring-offset-gray-800"
                    aria-label="Clear audio"
                  >
                    Clear
                  </button>
                )}
              </div>
              {previewUrl && (
                <audio
                  ref={audioRef}
                  controls
                  src={previewUrl}
                  className="w-full"
                  onError={(e) => console.error('Audio preview error:', e)}
                />
              )}
            </div>
          </div>

          <div style={{ display: "none" }}>
            <label htmlFor="body" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              More details
            </label>
            <textarea
              className="dark:bg-gray-900"
              id="body"
              name="body"
              value={form.body}
              onChange={(event) =>
                setForm((state) => ({ ...state, body: event.target.value }))
              }
              aria-label="Additional post details"
              tabIndex={-1}
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="w-full sm:w-auto px-6 py-3 text-base font-medium rounded-xl shadow-sm text-white bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400 dark:active:bg-indigo-600 transform transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:ring-offset-gray-800 disabled:opacity-50 hover:shadow-md dark:shadow-indigo-900/20"
              tabIndex={2}
              disabled={!form.head.trim() && !form.audio}
            >
              Send
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

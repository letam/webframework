import type { ReactElement, ReactNode } from "react";
import DOMPurify from 'dompurify';
import { useState } from "react";

import { useAuthContext } from "../contexts/auth";
import { prettyDate } from "../utils/date";
import { BACKEND_HOST } from "../api/constants";
import { transcribePost } from "../api/transcribePost";

import type { IPost, IAuthor } from "../types";
import { useQueryClient } from "@tanstack/react-query";

function FormatText({ children }: { children: ReactNode }): ReactElement {
  const content = DOMPurify.sanitize(children as string)
    .replace(/\n/g, "<br/>")
    .replace(
      /(https?:[^ ]+)( ?)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer" style="text-decoration: underline; word-break: break-all;">$1</a>$2'
    );
  // eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
  return <div dangerouslySetInnerHTML={{ __html: content }} />;
}

function AuthorNameDisplay({ author }: { author: IAuthor }): ReactElement {
  const auth = useAuthContext();
  if (auth.user.id === author.id) {
    return <>You ·</>;
  }
  return <>{author.username} ·</>;
}

interface Properties {
  post: IPost;
}

export default function Post({ post }: Properties): ReactElement {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryClient = useQueryClient(); // For refetching posts

  const handleTranscribe = async () => {
    setIsTranscribing(true);
    setError(null);
    try {
      const response = await transcribePost(post.id);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to transcribe audio');
      }
      queryClient.invalidateQueries({ queryKey: ["posts"] }); // Trigger posts refetch
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to transcribe audio');
    } finally {
      setIsTranscribing(false);
    }
  };

  return (
    <div className="py-4 border-b border-gray-200 dark:border-gray-700">
      <div className="text-sm text-gray-500 dark:text-gray-400">
        <AuthorNameDisplay author={post.author} /> {prettyDate(post.created)}
      </div>
      {post.head && (
        <div className="mt-1">
          <FormatText>{post.head}</FormatText>
        </div>
      )}
      {(post.signedAudioUrl || post.audio) && (
        <div className="mt-3">
          <audio
            controls
            src={post.signedAudioUrl || `${BACKEND_HOST}${post.audio}`}
            className="w-full"
            onError={(e) => {
              const audioElement = e.currentTarget;
              console.error('Audio playback error:', {
                event: e,
                src: audioElement.src,
                networkState: audioElement.networkState,
                readyState: audioElement.readyState,
                errorCode: audioElement.error
              });
            }}
          />
          {!post.body && (
            <div className="mt-2">
              <button
                onClick={handleTranscribe}
                disabled={isTranscribing}
                className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-blue-300 disabled:cursor-not-allowed"
              >
                {isTranscribing ? 'Transcribing...' : 'Transcribe Audio'}
              </button>
              {error && (
                <p className="mt-2 text-sm text-red-500">{error}</p>
              )}
            </div>
          )}
        </div>
      )}
      {post.body && (
        <div className="mt-3">
          <FormatText>{post.body}</FormatText>
        </div>
      )}
    </div>
  );
}

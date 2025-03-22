import type { ReactElement, ReactNode } from "react";
import DOMPurify from 'dompurify';

import { useAuthContext } from "../contexts/auth";
import { prettyDate } from "../utils/date";
import { BACKEND_HOST } from "../api/constants";

import type { IPost, IAuthor } from "../types";

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
        </div>
      )}
    </div>
  );
}

import type { ReactElement, ReactNode } from "react";

import { useAuthContext } from "../contexts/auth";
import { prettyDate } from "../utils/date";
import { BACKEND_HOST } from "../api/constants";

import type { IPost, IAuthor } from "../types";

function FormatText({ children }: { children: ReactNode }): ReactElement {
  // TODO: Handle unsafe post content / investigate hacks
  // TODO: If contains <script>, then do not set dangerously, and instead display button asking for permission.
  let content = children as string;
  content = content.replace(/\n/g, "<br/>");
  const markup = {
    __html: content.replace(
      /(https?:[^ ]+)( ?)/g,
      '<a href="$1" target="_blank" style="text-decoration: underline; word-break: break-all;">$1</a>$2'
    ),
  };
  return <div dangerouslySetInnerHTML={markup} />;
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
      {post.audio && (
        <div className="mt-3">
          <audio controls src={`${BACKEND_HOST}${post.audio}`} className="w-full" />
        </div>
      )}
    </div>
  );
}

import type { ReactElement, ReactNode } from "react";

import { useAuthContext } from "contexts/auth";
import { prettyDate } from "utils/date";

import type { IPost, IAuthor } from "types";

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
  // eslint-disable-next-line react/no-danger
  return <div dangerouslySetInnerHTML={markup} />;
}

function AuthorNameDisplay({ author }: { author: IAuthor }): ReactElement {
  const auth = useAuthContext();
  if (auth.user && auth.user.id === author.id) {
    return <>You ·</>;
  }
  return <>{author.username} ·</>;
}

interface Properties {
  post: IPost;
}
export default function Post({ post }: Properties): ReactElement {
  return (
    <div data-testid="PostCard">
      <h3 data-testid="PostCardHeadline" className="p-6 font-bold text-xl">
        <AuthorNameDisplay author={post.author} /> {prettyDate(post.created)}
        <br />
        <FormatText>{post.head}</FormatText>
      </h3>
    </div>
  );
}

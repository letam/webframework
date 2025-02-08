import type { ReactElement } from "react";
import { useNavigate } from "react-router-dom";

function PageNotFound({ children }: { children?: ReactElement }): ReactElement {
  const navigate = useNavigate();
  function goHome(): void {
    navigate("/");
  }

  return (
    <div>
      <h3>{children ?? "Page not found ☹️."}</h3>
      <button type="button" onClick={goHome}>
        Go home
      </button>
    </div>
  );
}

export default PageNotFound;

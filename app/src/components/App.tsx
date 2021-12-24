import React, { lazy, ReactElement, Suspense } from "react";
import { BrowserRouter, Route, Switch } from "react-router-dom";

import { AuthContextProvider } from "contexts/auth";
import LoadingOrError from "./LoadingOrError";

const Index = lazy(() => import("./Index"));
const Login = lazy(() => import("./Login"));
const FruitDetails = lazy(() => import("./FruitDetails"));
const FruitGallery = lazy(() => import("./FruitGallery"));

const routes = [
  {
    path: "/",
    component: Index,
    exact: true,
  },
  {
    path: "/login",
    component: Login,
    exact: true,
  },
  {
    path: "/fruits",
    component: FruitGallery,
    exact: true,
  },
  {
    path: "/:fruitName",
    component: FruitDetails,
  },
];

function goHome() {
  window.location.href = "/";
}

function PageNotFound() {
  return (
    <div>
      <h3>Page not found ☹️.</h3>
      <button type="button" onClick={goHome}>
        Go home
      </button>
    </div>
  );
}

function isPathSupported() {
  const { pathname } = window.location;
  const isPathFoundInRoutes = routes.some((route) => route.path === pathname);
  // TODO: Check to match paths containing variable values
  return isPathFoundInRoutes;
}

export default function App(): ReactElement {
  if (!isPathSupported()) {
    return <PageNotFound />;
  }
  return (
    <AuthContextProvider>
      <BrowserRouter>
        <Suspense fallback={<LoadingOrError />}>
          <Switch>
            {routes.map(({ path, component, exact }) => (
              <Route key={path} {...{ path, component, exact }} />
            ))}
          </Switch>
        </Suspense>
      </BrowserRouter>
    </AuthContextProvider>
  );
}

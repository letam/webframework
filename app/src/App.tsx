import type { ReactElement } from "react"
import { Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router";

import PWABadge from './PWABadge.tsx'

import { AuthContextProvider } from "./contexts/auth";
import routes from "./routes";

import LoadingOrError from "./components/LoadingOrError";

function App() : ReactElement {

  return (
    <>
    <AuthContextProvider>
      <BrowserRouter>
        <Suspense fallback={<LoadingOrError />}>
          <Routes>
            {routes.map(({ path, component: Component, exact }) => (
              <Route key={path} {...{ path, exact }} element={<Component />} />
            ))}
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthContextProvider>
      <PWABadge />
    </>
  )
}

export default App

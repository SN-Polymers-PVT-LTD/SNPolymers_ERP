import React from 'react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { render } from '@testing-library/react';

/** Renders the current router location so tests can assert URL state directly. */
export function LocationProbe({ testId = 'router-location' }) {
  const location = useLocation();
  return <output data-testid={testId}>{`${location.pathname}${location.search}${location.hash}`}</output>;
}

/** Minimal reusable controls for asserting Back/Forward behavior in MemoryRouter. */
export function HistoryControls() {
  const navigate = useNavigate();
  return (
    <div hidden>
      <button type="button" data-testid="router-back" onClick={() => navigate(-1)}>Back</button>
      <button type="button" data-testid="router-forward" onClick={() => navigate(1)}>Forward</button>
    </div>
  );
}

/**
 * Creates the minimal route tree required by a page or hook test. Keeping this
 * here ensures deep-link tests exercise React Router rather than a mocked URL.
 */
export function renderWithMemoryRoutes({
  initialEntries,
  routes,
  wrap = (children) => children,
  locationTestId = 'router-location',
}) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      {wrap(
        <>
          <Routes>
            {routes.map(({ path, element }) => (
              <Route key={path} path={path} element={element} />
            ))}
          </Routes>
          <LocationProbe testId={locationTestId} />
          <HistoryControls />
        </>
      )}
    </MemoryRouter>
  );
}

export function readLocation(testId = 'router-location') {
  return document.querySelector(`[data-testid="${testId}"]`)?.textContent;
}

/** Sets jsdom's browser URL for components that intentionally use hash APIs. */
export function setBrowserUrl(path) {
  window.history.replaceState(window.history.state, '', path);
}

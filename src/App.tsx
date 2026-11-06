import { HashRouter, Link, Route, Routes } from 'react-router-dom';
import { Icon, Layout, sideNav } from './components/Layout';
import { useSettings, useTheme } from './components/hooks';
import { PageHeader } from './components/ui';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { CheckinPage } from './features/checkin/CheckinPage';
import { TrainingPage } from './features/training/TrainingPage';
import { WorkoutForm } from './features/training/WorkoutForm';
import { TodosPage } from './features/todos/TodosPage';
import { BodyPage } from './features/body/BodyPage';
import { SettingsPage } from './features/settings/SettingsPage';

function MorePage() {
  const items = sideNav.filter((i) => !['/', '/checkin', '/training', '/todos'].includes(i.to));
  return (
    <>
      <PageHeader title="Mehr" />
      <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
        {items.map((i) => (
          <li key={i.to}>
            <Link to={i.to} className="flex min-h-14 items-center gap-3 px-4">
              <Icon name={i.icon} className="size-5 text-muted" />
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

export function App() {
  const settings = useSettings();
  useTheme(settings.theme);
  // HashRouter: funktioniert auf GitHub Pages ohne Server-Weiterleitungen
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="checkin" element={<CheckinPage />} />
          <Route path="training" element={<TrainingPage />} />
          <Route path="training/neu" element={<WorkoutForm />} />
          <Route path="training/:id" element={<WorkoutForm />} />
          <Route path="todos" element={<TodosPage />} />
          <Route path="koerper" element={<BodyPage />} />
          <Route path="einstellungen" element={<SettingsPage />} />
          <Route path="mehr" element={<MorePage />} />
          <Route path="*" element={<DashboardPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

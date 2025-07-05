import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import 'antd/dist/reset.css';
import './index.css';
import './styles/responsive.css';
import App from './App.jsx';
import Login from './pages/Login';
import Register from './pages/Register';
import UploadArtwork from './pages/UploadArtwork';
import Marketplace from './pages/Marketplace';
import ArtworkDetail from './pages/ArtworkDetail';
import MyArtworks from './pages/MyArtworks';
import Profile from './pages/Profile';
import EditArtwork from './pages/EditArtwork';
import Favorites from './pages/Favorites';
import AuthCallback from './pages/AuthCallback';
import { AuthProvider } from './context/AuthContext';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      {
        index: true,
        element: <Marketplace />,
      },
      {
        path: 'login',
        element: <Login />,
      },
      {
        path: 'register',
        element: <Register />,
      },
      {
        path: 'upload',
        element: <UploadArtwork />,
      },
      {
        path: 'artwork/:id',
        element: <ArtworkDetail />,
      },
      {
        path: 'my-artworks',
        element: <MyArtworks />,
      },
      {
        path: 'profile',
        element: <Profile />,
      },
      {
        path: 'edit-artwork/:id',
        element: <EditArtwork />,
      },
      {
        path: 'favorites',
        element: <Favorites />,
      },
      {
        path: 'auth/callback',
        element: <AuthCallback />,
      },
    ],
  },
]);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
);

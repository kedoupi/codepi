# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

KDP.Cool is a digital artwork trading platform built with React + Supabase. It allows digital artists to upload, showcase, and sell their artwork including illustrations, icons, and posters.

**Tech Stack:**
- Frontend: React 19 + Vite + Ant Design + React Router
- Backend: Supabase (PostgreSQL + Auth + Storage + Realtime)
- Authentication: Google OAuth via Supabase
- Payment: Stripe (planned)

## Development Commands

### Client (Frontend)
```bash
cd client
npm run dev          # Start development server at http://localhost:5173
npm run build        # Build for production
npm run lint         # Run ESLint
npm run preview      # Preview production build
```

### Server (Backend - Legacy)
```bash
cd server
# No specific commands - mostly legacy SQLite setup
```

### Database Setup
```bash
cd client
node setup-database.js    # Initialize database with sample data
node test-supabase.js      # Test Supabase connection
```

## Architecture

### Frontend Structure (`client/src/`)
- **components/** - Reusable UI components (ErrorDisplay, LoadingSpinner)
- **context/** - React contexts (AuthContext for user authentication)
- **hooks/** - Custom hooks (useAsyncError)
- **lib/** - Core services and utilities
  - `supabase.js` - Supabase client configuration
  - `artworks.js` - ArtworkService class for all artwork operations
  - `storage.js` - File upload and storage utilities
- **pages/** - Route components (Marketplace, Profile, Upload, etc.)
- **styles/** - CSS files including responsive.css

### Key Services

**AuthContext (`src/context/AuthContext.jsx`)**
- Manages user authentication state
- Google OAuth integration via Supabase
- Automatic profile creation for new users
- Functions: `signInWithGoogle()`, `signOut()`, `updateProfile()`

**ArtworkService (`src/lib/artworks.js`)**
- Complete CRUD operations for artworks
- Search and filtering capabilities
- Pagination support
- Favorite/unfavorite functionality
- Functions: `getArtworks()`, `createArtwork()`, `updateArtwork()`, `deleteArtwork()`, `searchArtworks()`

### Database Schema (Supabase)
- **profiles** - Extended user information
- **artworks** - Artwork metadata and details
- **categories** - Artwork categorization
- **favorites** - User artwork favorites
- **comments** - Artwork comments (planned)
- **orders** - Purchase orders (planned)

### Authentication Flow
1. User clicks Google login
2. Supabase redirects to Google OAuth
3. After authorization, user is redirected to `/auth/callback`
4. AuthContext automatically creates/updates user profile
5. User session is maintained via Supabase auth

### File Upload System
- Uses Supabase Storage with "artworks" bucket
- Supports image validation and compression
- Automatic thumbnail generation (planned)
- Watermark generation for previews (planned)

## Environment Setup

Required environment variables in `client/.env`:
```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_APP_URL=http://localhost:5173
```

## Development Guidelines

**Code Style:**
- Use PascalCase for component names
- Use camelCase for file names
- Prefer functional components with hooks
- Follow ESLint configuration

**Architecture Patterns:**
- All Supabase operations go through service classes (`artworks.js`)
- Use React Context for global state (auth, theme)
- Implement error boundaries with useAsyncError hook
- Responsive design using CSS Grid and Flexbox

**Security:**
- All database operations use Supabase Row Level Security (RLS)
- File uploads are type and size validated
- User input is sanitized through Supabase client

## Testing

Use the health check and test utilities:
```bash
cd client
node health-check.js      # Check app health
node quick-test.js        # Quick functionality test
```
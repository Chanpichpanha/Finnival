import React, { createContext, useContext, useCallback, useMemo, useState, useEffect } from 'react';
import { ClerkProvider, UserButton, useAuth, useUser, useClerk } from '@clerk/react';

const PUBLISHABLE_KEY = (process.env.REACT_APP_CLERK_PUBLISHABLE_KEY || '').trim();

export function checkHasAuthCookie() {
  if (typeof document === 'undefined') return false;
  const cookie = document.cookie || '';
  return /(?:^|;\s*)__client_uat=[1-9]\d*/.test(cookie);
}

const AppAuthContext = createContext({
  authEnabled: false,
  isLoaded: true,
  isSignedIn: false,
  hasAuthCookie: false,
  userId: null,
  userLabel: null,
  userEmail: null,
  getToken: async () => null,
  openSignIn: () => {},
  openSignUp: () => {},
  openUserProfile: () => {},
  signOut: async () => {}
});

class ClerkErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

function ClerkAuthBridge({ children }) {
  const { isLoaded, isSignedIn, userId, getToken: clerkGetToken } = useAuth();
  const { user } = useUser();
  const clerk = useClerk();
  const [pendingAction, setPendingAction] = useState(null);

  const hasAuthCookie = useMemo(() => checkHasAuthCookie(), []);

  useEffect(() => {
    if (isLoaded && pendingAction) {
      if (pendingAction === 'signIn') clerk.openSignIn?.();
      if (pendingAction === 'signUp') clerk.openSignUp?.();
      setPendingAction(null);
    }
  }, [isLoaded, pendingAction, clerk]);

  const openSignIn = useCallback(() => {
    if (clerk?.openSignIn) {
      clerk.openSignIn();
    } else {
      setPendingAction('signIn');
    }
  }, [clerk]);

  const openSignUp = useCallback(() => {
    if (clerk?.openSignUp) {
      clerk.openSignUp();
    } else {
      setPendingAction('signUp');
    }
  }, [clerk]);

  const getToken = useCallback(async () => {
    try {
      return await clerkGetToken();
    } catch (e) {
      return null;
    }
  }, [clerkGetToken]);

  const userEmail = user?.primaryEmailAddress?.emailAddress || null;
  const userLabel =
    user?.firstName ||
    user?.username ||
    userEmail ||
    null;

  const openUserProfile = useCallback(() => {
    clerk?.openUserProfile?.();
  }, [clerk]);

  const signOut = useCallback(async () => {
    if (clerk?.signOut) {
      await clerk.signOut(() => {});
    }
  }, [clerk]);

  const value = useMemo(() => ({
    authEnabled: true,
    isLoaded: Boolean(isLoaded),
    isSignedIn: Boolean(isSignedIn),
    hasAuthCookie,
    userId: userId || null,
    userLabel,
    userEmail,
    getToken,
    openSignIn,
    openSignUp,
    openUserProfile,
    signOut
  }), [isLoaded, isSignedIn, hasAuthCookie, userId, userLabel, userEmail, getToken, openSignIn, openSignUp, openUserProfile, signOut]);

  return <AppAuthContext.Provider value={value}>{children}</AppAuthContext.Provider>;
}

/**
 * Provides Clerk authentication across the app when REACT_APP_CLERK_PUBLISHABLE_KEY is set,
 * or falls back cleanly to local open mode when auth keys are not yet configured.
 */
export function AppAuthProvider({ children }) {
  if (!PUBLISHABLE_KEY) {
    return <>{children}</>;
  }

  return (
    <ClerkErrorBoundary fallback={<>{children}</>}>
      <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
        <ClerkAuthBridge>{children}</ClerkAuthBridge>
      </ClerkProvider>
    </ClerkErrorBoundary>
  );
}

export function useAppAuth() {
  return useContext(AppAuthContext);
}

export function AppUserButton() {
  const { authEnabled, isSignedIn } = useAppAuth();
  if (!authEnabled || !isSignedIn) return null;
  return (
    <UserButton
      appearance={{
        elements: {
          avatarBox: { width: 28, height: 28 }
        }
      }}
    />
  );
}

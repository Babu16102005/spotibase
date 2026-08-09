import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
import LoginScreen from './LoginScreen';
import { useAuthStore } from '../../store';
import { authApi } from '../../api/client';
import { makeAuthResponse } from '../../test/fixtures';

// The auth store calls the API client — mock it so no network is touched.
jest.mock('../../api/client', () => ({
  authApi: {
    login: jest.fn(),
    register: jest.fn(),
    refresh: jest.fn(),
    socialAuth: jest.fn(),
  },
}));

describe('LoginScreen', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false, error: null });
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    // Each test opts into a configured provider explicitly.
    delete process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
    delete process.env.EXPO_PUBLIC_APPLE_CLIENT_ID;
  });

  afterEach(() => {
    alertSpy.mockRestore();
    delete process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
    delete process.env.EXPO_PUBLIC_APPLE_CLIENT_ID;
  });

  it('renders email/password inputs and the Sign In button', () => {
    const { getByPlaceholderText, getByText } = render(<LoginScreen navigation={{}} />);

    expect(getByPlaceholderText('Email')).toBeTruthy();
    expect(getByPlaceholderText('Password')).toBeTruthy();
    expect(getByText('Sign In')).toBeTruthy();
    expect(getByText('SpotiBase')).toBeTruthy();
  });

  it('shows an alert and does not call the api when fields are empty', () => {
    const { getByText } = render(<LoginScreen navigation={{}} />);

    fireEvent.press(getByText('Sign In'));

    expect(alertSpy).toHaveBeenCalledWith('Error', 'Please fill in all fields');
    expect(authApi.login).not.toHaveBeenCalled();
  });

  it('logs in with the entered credentials', async () => {
    (authApi.login as jest.Mock).mockResolvedValue({ data: makeAuthResponse() });

    const { getByPlaceholderText, getByText } = render(<LoginScreen navigation={{}} />);
    fireEvent.changeText(getByPlaceholderText('Email'), 'alice@example.com');
    fireEvent.changeText(getByPlaceholderText('Password'), 'secret123');
    fireEvent.press(getByText('Sign In'));
    await act(async () => {});

    expect(authApi.login).toHaveBeenCalledWith({
      email: 'alice@example.com',
      password: 'secret123',
    });
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  it('disables the button and shows "Signing in..." while the request is pending', async () => {
    let resolveLogin: (value: unknown) => void = () => {};
    (authApi.login as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveLogin = resolve;
      })
    );

    const { getByPlaceholderText, getByText } = render(<LoginScreen navigation={{}} />);
    fireEvent.changeText(getByPlaceholderText('Email'), 'alice@example.com');
    fireEvent.changeText(getByPlaceholderText('Password'), 'secret123');
    fireEvent.press(getByText('Sign In'));

    expect(getByText('Signing in...')).toBeTruthy();

    resolveLogin({ data: makeAuthResponse() });
    await act(async () => {});

    expect(getByText('Sign In')).toBeTruthy();
  });

  it('shows an alert when login fails', async () => {
    (authApi.login as jest.Mock).mockRejectedValue({
      response: { data: { message: 'Bad credentials' } },
    });

    const { getByPlaceholderText, getByText } = render(<LoginScreen navigation={{}} />);
    fireEvent.changeText(getByPlaceholderText('Email'), 'alice@example.com');
    fireEvent.changeText(getByPlaceholderText('Password'), 'wrong');
    fireEvent.press(getByText('Sign In'));
    await act(async () => {});

    expect(alertSpy).toHaveBeenCalledWith('Login Failed', 'Bad credentials');
  });

  it('navigates to Register when the sign-up link is pressed', () => {
    const navigation = { navigate: jest.fn() };
    const { getByText } = render(<LoginScreen navigation={navigation} />);

    fireEvent.press(getByText("Don't have an account? Sign Up"));

    expect(navigation.navigate).toHaveBeenCalledWith('Register');
  });

  it('renders the Google and Apple social buttons', () => {
    const { getByTestId, getByText } = render(<LoginScreen navigation={{}} />);

    expect(getByTestId('social-button-google')).toBeTruthy();
    expect(getByTestId('social-button-apple')).toBeTruthy();
    expect(getByText('Continue with Google')).toBeTruthy();
    expect(getByText('Continue with Apple')).toBeTruthy();
    expect(getByText('or continue with')).toBeTruthy();
  });

  it('shows an unconfigured notice and does not call the api when Google is not configured', async () => {
    const { getByTestId, getByText } = render(<LoginScreen navigation={{}} />);

    fireEvent.press(getByTestId('social-button-google'));
    await act(async () => {});

    expect(getByText('Social login is not configured yet')).toBeTruthy();
    expect(authApi.socialAuth).not.toHaveBeenCalled();
  });

  it('authenticates via Google when configured and an idToken override is supplied', async () => {
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID = 'test-google-client-id';
    (authApi.socialAuth as jest.Mock).mockResolvedValue({ data: makeAuthResponse() });

    const { getByTestId } = render(
      <LoginScreen navigation={{}} socialIdTokenOverride={{ google: 'test-id-token' }} />
    );
    fireEvent.press(getByTestId('social-button-google'));
    await act(async () => {});

    expect(authApi.socialAuth).toHaveBeenCalledWith('google', 'test-id-token');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().user?.email).toBe('alice@example.com');
    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  it('shows an inline error message when social login fails', async () => {
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID = 'test-google-client-id';
    (authApi.socialAuth as jest.Mock).mockRejectedValue({
      response: { data: { message: 'Google account already linked' } },
    });

    const { getByTestId, getByText } = render(
      <LoginScreen navigation={{}} socialIdTokenOverride={{ google: 'test-id-token' }} />
    );
    fireEvent.press(getByTestId('social-button-google'));
    await act(async () => {});

    expect(getByText('Google account already linked')).toBeTruthy();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});

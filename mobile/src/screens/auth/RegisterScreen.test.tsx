import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
import RegisterScreen from './RegisterScreen';
import { useAuthStore } from '../../store';
import { authApi } from '../../api/client';
import { makeAuthResponse } from '../../test/fixtures';

jest.mock('../../api/client', () => ({
  authApi: {
    login: jest.fn(),
    register: jest.fn(),
    refresh: jest.fn(),
    socialAuth: jest.fn(),
  },
}));

describe('RegisterScreen', () => {
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

  it('renders email, username, password inputs and the Sign Up button', () => {
    const { getByPlaceholderText, getByText } = render(<RegisterScreen navigation={{}} />);

    expect(getByPlaceholderText('Email')).toBeTruthy();
    expect(getByPlaceholderText('Username')).toBeTruthy();
    expect(getByPlaceholderText('Password')).toBeTruthy();
    expect(getByText('Sign Up')).toBeTruthy();
    expect(getByText('Create your account')).toBeTruthy();
  });

  it('alerts and does not submit when required fields are empty', () => {
    const { getByText } = render(<RegisterScreen navigation={{}} />);

    fireEvent.press(getByText('Sign Up'));

    expect(alertSpy).toHaveBeenCalledWith('Error', 'Please fill in all fields');
    expect(authApi.register).not.toHaveBeenCalled();
  });

  it('rejects passwords shorter than 8 characters', () => {
    const { getByPlaceholderText, getByText } = render(<RegisterScreen navigation={{}} />);
    fireEvent.changeText(getByPlaceholderText('Email'), 'bob@example.com');
    fireEvent.changeText(getByPlaceholderText('Username'), 'bob');
    fireEvent.changeText(getByPlaceholderText('Password'), 'short');
    fireEvent.press(getByText('Sign Up'));

    expect(alertSpy).toHaveBeenCalledWith('Error', 'Password must be at least 8 characters');
    expect(authApi.register).not.toHaveBeenCalled();
  });

  it('registers with the entered credentials', async () => {
    (authApi.register as jest.Mock).mockResolvedValue({ data: makeAuthResponse() });

    const { getByPlaceholderText, getByText } = render(<RegisterScreen navigation={{}} />);
    fireEvent.changeText(getByPlaceholderText('Email'), 'bob@example.com');
    fireEvent.changeText(getByPlaceholderText('Username'), 'bob');
    fireEvent.changeText(getByPlaceholderText('Password'), 'password123');
    fireEvent.press(getByText('Sign Up'));
    await act(async () => {});

    expect(authApi.register).toHaveBeenCalledWith({
      email: 'bob@example.com',
      username: 'bob',
      password: 'password123',
    });
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('shows an alert when registration fails', async () => {
    (authApi.register as jest.Mock).mockRejectedValue({
      response: { data: { message: 'Email already taken' } },
    });

    const { getByPlaceholderText, getByText } = render(<RegisterScreen navigation={{}} />);
    fireEvent.changeText(getByPlaceholderText('Email'), 'bob@example.com');
    fireEvent.changeText(getByPlaceholderText('Username'), 'bob');
    fireEvent.changeText(getByPlaceholderText('Password'), 'password123');
    fireEvent.press(getByText('Sign Up'));
    await act(async () => {});

    expect(alertSpy).toHaveBeenCalledWith('Registration Failed', 'Email already taken');
  });

  it('goes back when the sign-in link is pressed', () => {
    const navigation = { goBack: jest.fn() };
    const { getByText } = render(<RegisterScreen navigation={navigation} />);

    fireEvent.press(getByText('Already have an account? Sign In'));

    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('renders the Google and Apple social buttons', () => {
    const { getByTestId, getByText } = render(<RegisterScreen navigation={{}} />);

    expect(getByTestId('social-button-google')).toBeTruthy();
    expect(getByTestId('social-button-apple')).toBeTruthy();
    expect(getByText('Continue with Google')).toBeTruthy();
    expect(getByText('Continue with Apple')).toBeTruthy();
    expect(getByText('or continue with')).toBeTruthy();
  });

  it('shows an unconfigured notice and does not call the api when Google is not configured', async () => {
    const { getByTestId, getByText } = render(<RegisterScreen navigation={{}} />);

    fireEvent.press(getByTestId('social-button-google'));
    await act(async () => {});

    expect(getByText('Social login is not configured yet')).toBeTruthy();
    expect(authApi.socialAuth).not.toHaveBeenCalled();
  });

  it('authenticates via Google when configured and an idToken override is supplied', async () => {
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID = 'test-google-client-id';
    (authApi.socialAuth as jest.Mock).mockResolvedValue({ data: makeAuthResponse() });

    const { getByTestId } = render(
      <RegisterScreen navigation={{}} socialIdTokenOverride={{ google: 'test-id-token' }} />
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
      <RegisterScreen navigation={{}} socialIdTokenOverride={{ google: 'test-id-token' }} />
    );
    fireEvent.press(getByTestId('social-button-google'));
    await act(async () => {});

    expect(getByText('Google account already linked')).toBeTruthy();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});

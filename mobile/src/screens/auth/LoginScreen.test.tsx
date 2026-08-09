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
  });

  afterEach(() => {
    alertSpy.mockRestore();
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
});

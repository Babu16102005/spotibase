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
  });

  afterEach(() => {
    alertSpy.mockRestore();
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
});

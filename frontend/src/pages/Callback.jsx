import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';

export default function Callback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { login } = useApp();

  useEffect(() => {
    const userId = searchParams.get('userId');
    const displayName = searchParams.get('displayName');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      console.error('Auth error:', error);
      navigate('/?error=' + error);
      return;
    }

    if (userId && displayName) {
      login(userId, displayName);
      
      if (state === 'host') {
        navigate('/host');
      } else {
        navigate('/');
      }
    } else {
      navigate('/?error=invalid_callback');
    }
  }, [searchParams, navigate, login]);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      fontSize: '1.2rem'
    }}>
      Completing authentication...
    </div>
  );
}

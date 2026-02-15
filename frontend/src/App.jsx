import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import Home from './pages/Home';
import Host from './pages/Host';
import Callback from './pages/Callback';
import Room from './pages/Room';
import './styles/Global.css';

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/host" element={<Host />} />
          <Route path="/callback" element={<Callback />} />
          <Route path="/room" element={<Room />} />
        </Routes>
      </AppProvider>
    </BrowserRouter>
  );
}

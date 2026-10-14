import React from 'react';
import {createRoot} from 'react-dom/client';
import {AuditApp} from '../../../packages/ui/AuditApp';
createRoot(document.getElementById('root')!).render(<React.StrictMode><AuditApp/></React.StrictMode>);

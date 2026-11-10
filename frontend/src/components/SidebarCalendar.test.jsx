import React from 'react';
import {test,expect,vi} from 'vitest';
import {render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import Sidebar from './Sidebar';
let role='admin';
vi.mock('./AuthContext',()=>({useAuth:()=>({user:{id:'test',role},logout:vi.fn()})}));
vi.mock('./ThemeContext',()=>({useTheme:()=>({theme:'light',toggleTheme:vi.fn()})}));
test.each(['admin','ho','factory_manager','accounts'])('%s has no separate Work Calendar sidebar link',value=>{role=value;render(<MemoryRouter initialEntries={['/']}><Sidebar/></MemoryRouter>);expect(screen.queryByRole('link',{name:/Work Calendar/})).not.toBeInTheDocument();});

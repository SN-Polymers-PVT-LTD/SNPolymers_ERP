import React,{useState} from 'react';
import {it,expect,beforeEach,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import StatutoryStateField from './StatutoryStateField';
import * as api from '../../api/payrollProfilesApi';vi.mock('../../api/payrollProfilesApi');
const states=['Assam','Bihar','West Bengal','Odisha'].map((name,i)=>({name,id:String(i+1)}));
function Form({initial={jurisdiction:''}, matchByName}){const [data,set]=useState(initial);return <><StatutoryStateField data={data} onChange={set} matchByName={matchByName}/><output data-testid="selection">{JSON.stringify(data)}</output></>;}
const mount=props=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><Form {...props}/></QueryClientProvider>);
beforeEach(()=>{vi.resetAllMocks();api.getStatutoryStates.mockResolvedValue({data:{result:states}});api.registerStatutoryState.mockResolvedValue({data:{result:{id:'5',name:'New State'}}});});
it('lists saved states and puts Add state beside the dropdown',async()=>{mount();await screen.findByRole('option',{name:'Assam'});expect(screen.queryByRole('option',{name:'Add state'})).not.toBeInTheDocument();fireEvent.change(screen.getByLabelText(/Jurisdiction \/ state/),{target:{value:'3'}});expect(screen.getByTestId('selection')).toHaveTextContent('"state_id":"3"');expect(screen.getByTestId('selection')).toHaveTextContent('West Bengal');});
it('persists a new state with the dedicated action and selects the canonical returned identity',async()=>{mount();await screen.findByRole('option',{name:'Assam'});fireEvent.click(screen.getByRole('button',{name:'Add state'}));fireEvent.change(screen.getByLabelText('New state name'),{target:{value:'New State'}});fireEvent.click(screen.getByRole('button',{name:'Save state'}));await waitFor(()=>expect(api.registerStatutoryState).toHaveBeenCalledWith({name:'New State'}));expect(await screen.findByRole('option',{name:'New State'})).toBeInTheDocument();expect(screen.getByLabelText(/Jurisdiction \/ state/)).toHaveValue('5');});
it('has retryable loading failures without inventing local state records',async()=>{api.getStatutoryStates.mockRejectedValueOnce(new Error('offline'));mount();expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load states');fireEvent.click(screen.getByRole('button',{name:'Retry states'}));expect(await screen.findByRole('option',{name:'Odisha'})).toBeInTheDocument();});

it('does not display a state as selected when the guided draft only has its name',async()=>{
 mount({initial:{state_id:null,jurisdiction:'Assam'},matchByName:false});
 await screen.findByRole('option',{name:'Assam'});
 const state=screen.getByRole('combobox');
 expect(state).toHaveValue('');
 fireEvent.change(state,{target:{value:'1'}});
 expect(state).toHaveValue('1');
 expect(screen.getByTestId('selection')).toHaveTextContent('"state_id":"1"');
});

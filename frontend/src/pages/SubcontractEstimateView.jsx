import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '../components/ui';
import SubcontractEstimateForm from './SubcontractEstimateForm';
const SubcontractEstimateView = () => { const { id } = useParams(); const navigate = useNavigate(); return <div><div className="mb-4 flex justify-end"><Button variant="secondary" onClick={() => navigate(`/subcontract-estimates/${id}/edit`)}>Open Draft Editor</Button></div><SubcontractEstimateForm /></div>; };
export default SubcontractEstimateView;

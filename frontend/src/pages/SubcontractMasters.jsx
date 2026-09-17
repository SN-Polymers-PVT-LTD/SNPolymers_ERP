import { useState } from 'react';
import { Button } from '../components/ui';
import SubcontractWorkMaster from './SubcontractWorkMaster';
import SubcontractorMaster from './SubcontractorMaster';

export default function SubcontractMasters() {
  const [activeTab, setActiveTab] = useState('work');

  return (
    <div>
      <div className="px-4 pt-4 sm:px-6 sm:pt-6">
        <div className="flex gap-2">
          <Button size="sm" variant={activeTab === 'work' ? 'primary' : 'glass'} onClick={() => setActiveTab('work')}>
            Subcontract Work Master
          </Button>
          <Button size="sm" variant={activeTab === 'subcontractor' ? 'primary' : 'glass'} onClick={() => setActiveTab('subcontractor')}>
            Subcontractor Master
          </Button>
        </div>
      </div>
      {activeTab === 'work' ? <SubcontractWorkMaster /> : <SubcontractorMaster />}
    </div>
  );
}

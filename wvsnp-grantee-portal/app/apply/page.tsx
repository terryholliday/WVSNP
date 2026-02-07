'use client';

import { useState } from 'react';
import Link from 'next/link';

interface GranteeApplication {
  organizationName: string;
  ein: string;
  organizationType: string;
  yearEstablished: string;
  contactName: string;
  contactTitle: string;
  contactEmail: string;
  contactPhone: string;
  mailingAddress: string;
  city: string;
  state: string;
  zipCode: string;
  serviceCounties: string[];
  annualBudget: string;
  currentSpayNeuterProgram: boolean;
  programDescription: string;
  veterinaryPartners: string;
  estimatedAnnualCapacity: string;
  requestedAllocation: string;
  matchingFunds: string;
  trackingCapability: string;
}

const WV_COUNTIES = [
  'Barbour', 'Berkeley', 'Boone', 'Braxton', 'Brooke', 'Cabell', 'Calhoun', 'Clay',
  'Doddridge', 'Fayette', 'Gilmer', 'Grant', 'Greenbrier', 'Hampshire', 'Hancock',
  'Hardy', 'Harrison', 'Jackson', 'Jefferson', 'Kanawha', 'Lewis', 'Lincoln', 'Logan',
  'Marion', 'Marshall', 'Mason', 'McDowell', 'Mercer', 'Mineral', 'Mingo', 'Monongalia',
  'Monroe', 'Morgan', 'Nicholas', 'Ohio', 'Pendleton', 'Pleasants', 'Pocahontas',
  'Preston', 'Putnam', 'Raleigh', 'Randolph', 'Ritchie', 'Roane', 'Summers', 'Taylor',
  'Tucker', 'Tyler', 'Upshur', 'Wayne', 'Webster', 'Wetzel', 'Wirt', 'Wood', 'Wyoming'
];

export default function GranteeApplicationPage() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<GranteeApplication>({
    organizationName: '',
    ein: '',
    organizationType: '',
    yearEstablished: '',
    contactName: '',
    contactTitle: '',
    contactEmail: '',
    contactPhone: '',
    mailingAddress: '',
    city: '',
    state: 'WV',
    zipCode: '',
    serviceCounties: [],
    annualBudget: '',
    currentSpayNeuterProgram: false,
    programDescription: '',
    veterinaryPartners: '',
    estimatedAnnualCapacity: '',
    requestedAllocation: '',
    matchingFunds: '',
    trackingCapability: ''
  });

  const updateField = (field: keyof GranteeApplication, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const toggleCounty = (county: string) => {
    setForm(prev => ({
      ...prev,
      serviceCounties: prev.serviceCounties.includes(county)
        ? prev.serviceCounties.filter(c => c !== county)
        : [...prev.serviceCounties, county]
    }));
  };

  const handleSubmit = async () => {
    console.log('Submitting application:', form);
    alert('Application submitted! (This will connect to the API in production)');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <Link href="/" className="flex items-center text-blue-600 hover:text-blue-800">
              <svg className="h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to Home
            </Link>
            <div className="text-sm text-gray-600">
              <span className="font-medium">Step {step} of 4</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white rounded-lg shadow-md p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-6">
            WVSNP Grantee Application
          </h1>

          {step === 1 && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-gray-900">Organization Information</h2>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Organization Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.organizationName}
                  onChange={(e) => updateField('organizationName', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    EIN (Tax ID) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.ein}
                    onChange={(e) => updateField('ein', e.target.value)}
                    placeholder="XX-XXXXXXX"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Year Established <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    value={form.yearEstablished}
                    onChange={(e) => updateField('yearEstablished', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Organization Type <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.organizationType}
                  onChange={(e) => updateField('organizationType', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                  required
                >
                  <option value="">Select type...</option>
                  <option value="animal_shelter">Animal Shelter</option>
                  <option value="rescue_organization">Rescue Organization</option>
                  <option value="humane_society">Humane Society</option>
                  <option value="spca">SPCA</option>
                  <option value="other">Other 501(c)(3)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Annual Operating Budget <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.annualBudget}
                  onChange={(e) => updateField('annualBudget', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                  required
                >
                  <option value="">Select range...</option>
                  <option value="under_50k">Under $50,000</option>
                  <option value="50k_100k">$50,000 - $100,000</option>
                  <option value="100k_250k">$100,000 - $250,000</option>
                  <option value="250k_500k">$250,000 - $500,000</option>
                  <option value="over_500k">Over $500,000</option>
                </select>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={() => setStep(2)}
                  className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  Next: Contact Information
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-gray-900">Contact & Location Information</h2>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Primary Contact Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.contactName}
                    onChange={(e) => updateField('contactName', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Title <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.contactTitle}
                    onChange={(e) => updateField('contactTitle', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    value={form.contactEmail}
                    onChange={(e) => updateField('contactEmail', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Phone <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="tel"
                    value={form.contactPhone}
                    onChange={(e) => updateField('contactPhone', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Mailing Address <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.mailingAddress}
                  onChange={(e) => updateField('mailingAddress', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                  required
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    City <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.city}
                    onChange={(e) => updateField('city', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    State
                  </label>
                  <input
                    type="text"
                    value="WV"
                    disabled
                    className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-100 text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    ZIP Code <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.zipCode}
                    onChange={(e) => updateField('zipCode', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Service Area - Select Counties <span className="text-red-500">*</span>
                </label>
                <div className="border border-gray-300 rounded-md p-4 max-h-60 overflow-y-auto">
                  <div className="grid grid-cols-3 gap-2">
                    {WV_COUNTIES.map(county => (
                      <label key={county} className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.serviceCounties.includes(county)}
                          onChange={() => toggleCounty(county)}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700">{county}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Selected: {form.serviceCounties.length} counties
                </p>
              </div>

              <div className="flex justify-between">
                <button
                  onClick={() => setStep(1)}
                  className="px-6 py-3 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep(3)}
                  className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  Next: Program Details
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-gray-900">Program Capacity & Experience</h2>
              
              <div>
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.currentSpayNeuterProgram}
                    onChange={(e) => updateField('currentSpayNeuterProgram', e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-700">
                    We currently operate a spay/neuter program
                  </span>
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Program Description <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={form.programDescription}
                  onChange={(e) => updateField('programDescription', e.target.value)}
                  rows={4}
                  placeholder="Describe your current or proposed spay/neuter program, including how you would administer WVSNP grant funds..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Veterinary Partners <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={form.veterinaryPartners}
                  onChange={(e) => updateField('veterinaryPartners', e.target.value)}
                  rows={3}
                  placeholder="List veterinary clinics you partner with or plan to partner with for WVSNP services..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Estimated Annual Capacity <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.estimatedAnnualCapacity}
                  onChange={(e) => updateField('estimatedAnnualCapacity', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                  required
                >
                  <option value="">Select estimated surgeries per year...</option>
                  <option value="under_100">Under 100 surgeries</option>
                  <option value="100_250">100-250 surgeries</option>
                  <option value="250_500">250-500 surgeries</option>
                  <option value="500_1000">500-1,000 surgeries</option>
                  <option value="over_1000">Over 1,000 surgeries</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tracking & Reporting Capability <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={form.trackingCapability}
                  onChange={(e) => updateField('trackingCapability', e.target.value)}
                  rows={3}
                  placeholder="Describe your ability to track voucher issuance, service completion, and report outcomes to WVDA..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                  required
                />
              </div>

              <div className="flex justify-between">
                <button
                  onClick={() => setStep(2)}
                  className="px-6 py-3 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep(4)}
                  className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  Next: Funding Request
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-gray-900">Funding Request</h2>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Requested Grant Allocation <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.requestedAllocation}
                  onChange={(e) => updateField('requestedAllocation', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                  required
                >
                  <option value="">Select amount...</option>
                  <option value="10000">$10,000</option>
                  <option value="25000">$25,000</option>
                  <option value="50000">$50,000</option>
                  <option value="75000">$75,000</option>
                  <option value="100000">$100,000</option>
                  <option value="150000">$150,000</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Matching Funds / Cost Share <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={form.matchingFunds}
                  onChange={(e) => updateField('matchingFunds', e.target.value)}
                  rows={3}
                  placeholder="Describe any matching funds, in-kind contributions, or cost-sharing arrangements..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                  required
                />
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="font-semibold text-blue-900 mb-2">Application Review</h3>
                <p className="text-sm text-blue-800 mb-2">
                  By submitting this application, you certify that:
                </p>
                <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
                  <li>Your organization is a 501(c)(3) nonprofit</li>
                  <li>All information provided is accurate and complete</li>
                  <li>You will comply with WVSNP program requirements</li>
                  <li>You will submit required quarterly reports</li>
                </ul>
              </div>

              <div className="flex justify-between">
                <button
                  onClick={() => setStep(3)}
                  className="px-6 py-3 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  Back
                </button>
                <button
                  onClick={handleSubmit}
                  className="px-6 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  Submit Application
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

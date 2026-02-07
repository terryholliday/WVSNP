'use client';

import { apiClient } from '@/lib/api-client';
import { generateReferenceCode } from '@/lib/reference-code';

interface EligibilityForm {
  county: string;
  hasPets: boolean;
  householdSize: number;
  annualIncome: number;
}

export default function EligibilityPage() {
  const [form, setForm] = useState<EligibilityForm>({
    county: '',
    hasPets: false,
    householdSize: 1,
    annualIncome: 0
  });

  const [isEligible, setIsEligible] = useState<boolean | null>(null);
  const [showResults, setShowResults] = useState(false);

  const handleInputChange = (field: keyof EligibilityForm, value: string | number | boolean) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const checkEligibility = () => {
    // Basic eligibility checks
    const hasValidCounty = WV_COUNTIES.includes(form.county as any);
    const hasPets = form.hasPets;
    const meetsIncomeRequirement = form.annualIncome <= getIncomeThreshold(form.householdSize);

    const eligible = hasValidCounty && hasPets && meetsIncomeRequirement;
    setIsEligible(eligible);
    setShowResults(true);
  };

  const resetForm = () => {
    setForm({
      county: '',
      hasPets: false,
      householdSize: 1,
      annualIncome: 0
    });
    setIsEligible(null);
    setShowResults(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <Link href="/" className="flex items-center">
                <svg className="h-8 w-8 text-blue-600 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                <span className="text-lg font-semibold text-gray-900">Back to Home</span>
              </Link>
            </div>
            <div className="text-sm text-gray-600">
              <span className="font-medium">Step 1 of 6:</span> Eligibility Screening
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {!showResults ? (
          /* Eligibility Form */
          <div className="bg-white rounded-lg shadow-md p-8">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold text-gray-900 mb-4">
                Check Your Eligibility
              </h1>
              <p className="text-lg text-gray-600">
                Before you start your application, let's make sure you qualify for the West Virginia Spay/Neuter Voucher Program.
              </p>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); checkEligibility(); }} className="space-y-6">
              {/* County Selection */}
              <div>
                <label htmlFor="county" className="block text-sm font-medium text-gray-700 mb-2">
                  Which West Virginia county do you live in? <span className="text-red-500">*</span>
                </label>
                <select
                  id="county"
                  value={form.county}
                  onChange={(e) => handleInputChange('county', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  required
                >
                  <option value="">Select your county...</option>
                  {WV_COUNTIES.map(county => (
                    <option key={county} value={county}>{county} County</option>
                  ))}
                </select>
              </div>

              {/* Pet Ownership */}
              <div>
                <fieldset>
                  <legend className="block text-sm font-medium text-gray-700 mb-3">
                    Do you currently own or are you the primary caretaker of a dog or cat? <span className="text-red-500">*</span>
                  </legend>
                  <div className="space-y-2">
                    <label className="flex items-center">
                      <input
                        type="radio"
                        name="hasPets"
                        value="true"
                        checked={form.hasPets === true}
                        onChange={() => handleInputChange('hasPets', true)}
                        className="focus:ring-blue-500 h-4 w-4 text-blue-600 border-gray-300"
                      />
                      <span className="ml-2 text-sm text-gray-700">Yes</span>
                    </label>
                    <label className="flex items-center">
                      <input
                        type="radio"
                        name="hasPets"
                        value="false"
                        checked={form.hasPets === false}
                        onChange={() => handleInputChange('hasPets', false)}
                        className="focus:ring-blue-500 h-4 w-4 text-blue-600 border-gray-300"
                      />
                      <span className="ml-2 text-sm text-gray-700">No</span>
                    </label>
                  </div>
                </fieldset>
              </div>

              {/* Household Size */}
              <div>
                <label htmlFor="householdSize" className="block text-sm font-medium text-gray-700 mb-2">
                  How many people live in your household? <span className="text-red-500">*</span>
                </label>
                <select
                  id="householdSize"
                  value={form.householdSize}
                  onChange={(e) => handleInputChange('householdSize', parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                >
                  {[1,2,3,4,5,6,7,8].map(size => (
                    <option key={size} value={size}>{size} {size === 1 ? 'person' : 'people'}</option>
                  ))}
                  <option value="9">9+ people</option>
                </select>
              </div>

              {/* Income */}
              <div>
                <label htmlFor="annualIncome" className="block text-sm font-medium text-gray-700 mb-2">
                  What is your household's total annual income? <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <span className="text-gray-500 sm:text-sm">$</span>
                  </div>
                  <input
                    type="number"
                    id="annualIncome"
                    value={form.annualIncome || ''}
                    onChange={(e) => handleInputChange('annualIncome', parseInt(e.target.value) || 0)}
                    className="w-full pl-7 pr-12 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    placeholder="0"
                    min="0"
                    required
                  />
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                    <span className="text-gray-500 sm:text-sm">per year</span>
                  </div>
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  Income limit for {form.householdSize} {form.householdSize === 1 ? 'person' : 'people'}: ${getIncomeThreshold(form.householdSize).toLocaleString()}
                </p>
              </div>

              {/* Submit Button */}
              <div className="pt-4">
                <button
                  type="submit"
                  className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!form.county || form.hasPets === null || !form.annualIncome}
                >
                  Check My Eligibility
                </button>
              </div>
            </form>
          </div>
        ) : (
          /* Results */
          <div className="bg-white rounded-lg shadow-md p-8">
            <div className="text-center mb-8">
              {isEligible ? (
                <>
                  <div className="flex justify-center mb-6">
                    <div className="bg-green-100 rounded-full p-4">
                      <svg className="h-16 w-16 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                  </div>
                  <h1 className="text-3xl font-bold text-gray-900 mb-4">
                    Great! You May Be Eligible
                  </h1>
                  <p className="text-lg text-gray-600 mb-6">
                    Based on your responses, you appear to meet the basic eligibility requirements for the West Virginia Spay/Neuter Voucher Program.
                  </p>
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
                    <p className="text-green-800">
                      <strong>Next steps:</strong> Complete your full application to determine final eligibility and voucher amount.
                    </p>
                  </div>
                  <Link
                    href="/apply/applicant"
                    className="inline-flex items-center px-8 py-4 border border-transparent text-lg font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                  >
                    Continue to Application
                    <svg className="ml-2 -mr-1 w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 111.414-1.414L14.414 11H3a1 1 0 110-2h11.414l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </Link>
                </>
              ) : (
                <>
                  <div className="flex justify-center mb-6">
                    <div className="bg-red-100 rounded-full p-4">
                      <svg className="h-16 w-16 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                      </svg>
                    </div>
                  </div>
                  <h1 className="text-3xl font-bold text-gray-900 mb-4">
                    Not Eligible at This Time
                  </h1>
                  <p className="text-lg text-gray-600 mb-6">
                    Unfortunately, based on your responses, you don't meet the current eligibility requirements for the West Virginia Spay/Neuter Voucher Program.
                  </p>

                  {/* Alternative Resources */}
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6 text-left">
                    <h3 className="text-lg font-semibold text-blue-900 mb-3">Alternative Resources Available</h3>
                    <div className="space-y-3">
                      <div>
                        <h4 className="font-medium text-blue-800">WVDA Low-Cost Spay/Neuter Clinics</h4>
                        <p className="text-sm text-blue-700">Reduced-price services available at participating veterinary clinics statewide.</p>
                      </div>
                      <div>
                        <h4 className="font-medium text-blue-800">Humane Society Programs</h4>
                        <p className="text-sm text-blue-700">Many local humane societies offer subsidized spay/neuter services.</p>
                      </div>
                      <div>
                        <h4 className="font-medium text-blue-800">Pet Assistance Programs</h4>
                        <p className="text-sm text-blue-700">Check with local animal shelters and rescue organizations for additional assistance.</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <button
                      onClick={resetForm}
                      className="w-full flex justify-center py-3 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    >
                      Check Eligibility Again
                    </button>
                    <div className="text-center">
                      <p className="text-sm text-gray-600">
                        Have questions? Call our helpline: <span className="font-medium">(304) 123-4567</span>
                      </p>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

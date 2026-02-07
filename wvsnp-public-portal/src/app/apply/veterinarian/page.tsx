'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { FormField } from '@/components/forms/form-field';
import { Button } from '@/components/forms/button';

// Mock vet data - in real implementation, this would come from VET_ENROLLED events
interface Veterinarian {
  id: string;
  name: string;
  clinicName: string;
  city: string;
  county: string;
  phone: string;
  distance?: number; // miles from applicant
}

const MOCK_VETS: Veterinarian[] = [
  { id: '1', name: 'Dr. Sarah Johnson', clinicName: 'Kanawha Valley Animal Hospital', city: 'Charleston', county: 'Kanawha', phone: '(304) 555-0101' },
  { id: '2', name: 'Dr. Michael Chen', clinicName: 'Charleston Pet Care', city: 'Charleston', county: 'Kanawha', phone: '(304) 555-0102' },
  { id: '3', name: 'Dr. Emily Rodriguez', clinicName: 'South Charleston Veterinary Clinic', city: 'South Charleston', county: 'Kanawha', phone: '(304) 555-0103' },
  { id: '4', name: 'Dr. David Wilson', clinicName: 'Huntington Animal Medical Center', city: 'Huntington', county: 'Cabell', phone: '(304) 555-0104' },
  { id: '5', name: 'Dr. Lisa Thompson', clinicName: 'Morgantown Veterinary Hospital', city: 'Morgantown', county: 'Monongalia', phone: '(304) 555-0105' },
  { id: '6', name: 'Dr. Robert Davis', clinicName: 'Wheeling Veterinary Clinic', city: 'Wheeling', county: 'Ohio', phone: '(304) 555-0106' },
];

export default function VeterinarianPage() {
  const [selectedVet, setSelectedVet] = useState<string>('');
  const [applicantCounty, setApplicantCounty] = useState<string>('Kanawha'); // This would come from previous step
  const [availableVets, setAvailableVets] = useState<Veterinarian[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    // Filter vets by county, or show nearest if none in county
    let vets = MOCK_VETS.filter(vet => vet.county === applicantCounty);

    if (vets.length === 0) {
      // If no vets in applicant's county, show nearest options
      // In real implementation, this would calculate actual distances
      vets = MOCK_VETS.slice(0, 3).map(vet => ({
        ...vet,
        distance: Math.floor(Math.random() * 50) + 10 // Mock distance
      }));
    }

    setAvailableVets(vets);
  }, [applicantCounty]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // Save vet selection to API and offline store (Phase 2: API Integration)

      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Navigate to next step
      window.location.href = '/apply/evidence';
    } catch (error) {
      console.error('Error saving vet selection:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isFormValid = () => {
    return selectedVet.length > 0;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <Link href="/apply/animals" className="flex items-center">
                <svg className="h-8 w-8 text-blue-600 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                <span className="text-lg font-semibold text-gray-900">Back to Animals</span>
              </Link>
            </div>
            <div className="text-sm text-gray-600">
              <span className="font-medium">Step 4 of 6:</span> Choose Veterinarian
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white rounded-lg shadow-md p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">
              Choose Your Veterinarian
            </h1>
            <p className="text-lg text-gray-600">
              Select a participating veterinarian who will perform the spay/neuter services. Your voucher can only be used at this clinic.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* County Info */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-blue-800">
                <strong>Showing veterinarians for {applicantCounty} County</strong>
                {availableVets.length > 0 && availableVets[0].distance && (
                  <span className="block text-sm mt-1">
                    No participating vets in your county. Showing nearest options.
                  </span>
                )}
              </p>
            </div>

            {/* Vet Selection */}
            <FormField
              label="Select a Veterinarian"
              name="veterinarian"
              required
            >
              <div className="space-y-3">
                {/* No Preference Option */}
                <label className="flex items-start p-4 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input
                    type="radio"
                    name="veterinarian"
                    value="no-preference"
                    checked={selectedVet === 'no-preference'}
                    onChange={(e) => setSelectedVet(e.target.value)}
                    className="mt-1 focus:ring-blue-500 h-4 w-4 text-blue-600 border-gray-300"
                  />
                  <div className="ml-3">
                    <div className="font-medium text-gray-900">No Preference</div>
                    <div className="text-sm text-gray-600">
                      WVDA will assign you to an available participating veterinarian in your area.
                    </div>
                  </div>
                </label>

                {/* Participating Vets */}
                {availableVets.map(vet => (
                  <label key={vet.id} className="flex items-start p-4 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                    <input
                      type="radio"
                      name="veterinarian"
                      value={vet.id}
                      checked={selectedVet === vet.id}
                      onChange={(e) => setSelectedVet(e.target.value)}
                      className="mt-1 focus:ring-blue-500 h-4 w-4 text-blue-600 border-gray-300"
                    />
                    <div className="ml-3 flex-1">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-medium text-gray-900">{vet.name}</div>
                          <div className="text-sm text-gray-600">{vet.clinicName}</div>
                          <div className="text-sm text-gray-600">{vet.city}, WV</div>
                        </div>
                        <div className="text-right">
                          <div className="font-medium text-gray-900">{vet.phone}</div>
                          {vet.distance && (
                            <div className="text-sm text-gray-500">{vet.distance} miles away</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </FormField>

            {/* Important Notice */}
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex">
                <svg className="h-5 w-5 text-yellow-400 flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-yellow-800">
                    Important: Voucher Restrictions
                  </h3>
                  <div className="text-sm text-yellow-700 mt-1">
                    <ul className="list-disc list-inside space-y-1">
                      <li>Your voucher can only be used at the selected veterinarian's clinic</li>
                      <li>Services must be completed within 6 months of voucher issuance</li>
                      <li>You must bring proof of residency and income verification to your appointment</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* Navigation */}
            <div className="flex justify-between pt-6 border-t border-gray-200">
              <Link href="/apply/animals">
                <Button variant="outline" type="button">
                  <svg className="mr-2 -ml-1 w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Back
                </Button>
              </Link>

              <Button
                type="submit"
                disabled={!isFormValid() || isSubmitting}
                loading={isSubmitting}
              >
                Continue to Evidence Upload
                <svg className="ml-2 -mr-1 w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 111.414-1.414L14.414 11H3a1 1 0 110-2h11.414l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </Button>
            </div>
          </form>

          {/* Progress Indicator */}
          <div className="mt-8 pt-6 border-t border-gray-200">
            <div className="flex items-center justify-between text-sm text-gray-600">
              <span>Step 4 of 6</span>
              <span>Your selection is saved automatically</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

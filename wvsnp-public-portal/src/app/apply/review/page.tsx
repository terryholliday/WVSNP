'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FormField } from '@/components/forms/form-field';
import { Button } from '@/components/forms/button';
import { apiClient } from '@/lib/api-client';
import { generateReferenceCode } from '@/lib/reference-code';

// Mock data - in real implementation, this would come from wizard state
const mockApplicationData = {
  applicant: {
    firstName: 'John',
    lastName: 'Doe',
    address: '123 Main Street, Charleston, WV 25301',
    email: 'john.doe@example.com',
    phone: '(304) 555-0123',
    preferredContact: 'email'
  },
  animals: [
    {
      species: 'Dog',
      name: 'Fluffy',
      ageMonths: 24,
      sex: 'Female',
      breed: 'Labrador Retriever',
      spayNeuterStatus: 'Needs spay/neuter'
    }
  ],
  veterinarian: {
    name: 'Dr. Sarah Johnson',
    clinic: 'Kanawha Valley Animal Hospital',
    city: 'Charleston, WV',
    phone: '(304) 555-0101'
  },
  financial: {
    requestedAmount: 50000, // $500
    matchCommitment: 12500  // $125
  },
  referenceCode: 'WVSNP-A7K2-M9X4'
};

export default function ReviewPage() {
  const [certificationAccepted, setCertificationAccepted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!certificationAccepted) {
      alert('Please certify that the information is accurate before submitting.');
      return;
    }

    setIsSubmitting(true);

    try {
      // Generate unique IDs for this application
      const applicationId = crypto.randomUUID();
      const actorId = crypto.randomUUID();
      const correlationId = crypto.randomUUID();
      const referenceCode = generateReferenceCode();

      // Step 1: Start the application
      const startResult = await apiClient.startApplication({
        commandId: crypto.randomUUID(),
        applicationId,
        granteeId: crypto.randomUUID(), // Would come from organization selection
        grantCycleId: '2026', // Current grant cycle
        organizationName: 'Mock Organization', // Would come from applicant form
        organizationType: 'Individual', // Would come from applicant form
        orgId: '550e8400-e29b-41d4-a716-446655440000', // WVSNP Program Org ID
        actorId,
        correlationId,
        causationId: null,
        occurredAt: new Date().toISOString()
      });

      if (!startResult.success) {
        throw new Error(startResult.error?.message || 'Failed to start application');
      }

      // Step 2: Submit the application
      const submitResult = await apiClient.submitApplication({
        commandId: crypto.randomUUID(),
        applicationId,
        requestedAmountCents: 50000, // $500 - would come from vet/animal selection
        matchCommitmentCents: 12500, // $125 - would come from eligibility
        sectionsCompleted: ['eligibility', 'applicant', 'animals', 'veterinarian', 'evidence'],
        orgId: '550e8400-e29b-41d4-a716-446655440000', // WVSNP Program Org ID
        actorId,
        correlationId,
        causationId: correlationId,
        occurredAt: new Date().toISOString()
      });

      if (!submitResult.success) {
        throw new Error(submitResult.error?.message || 'Failed to submit application');
      }

      // Store reference code for confirmation page (in real app, use localStorage or context)
      localStorage.setItem('lastReferenceCode', referenceCode);

      // Navigate to confirmation
      window.location.href = '/apply/confirmation';

    } catch (error) {
      console.error('Error submitting application:', error);
      alert('Error submitting application. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <Link href="/apply/evidence" className="flex items-center">
                <svg className="h-8 w-8 text-blue-600 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                <span className="text-lg font-semibold text-gray-900">Back to Evidence</span>
              </Link>
            </div>
            <div className="text-sm text-gray-600">
              <span className="font-medium">Step 6 of 6:</span> Review & Submit
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white rounded-lg shadow-md p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">
              Review Your Application
            </h1>
            <p className="text-lg text-gray-600">
              Please review all information below. Once submitted, you can check your application status using your reference code.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-8">
            {/* Applicant Information */}
            <div className="bg-gray-50 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Applicant Information</h3>
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <dt className="text-sm font-medium text-gray-500">Name</dt>
                  <dd className="text-sm text-gray-900">{mockApplicationData.applicant.firstName} {mockApplicationData.applicant.lastName}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">Address</dt>
                  <dd className="text-sm text-gray-900">{mockApplicationData.applicant.address}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">Email</dt>
                  <dd className="text-sm text-gray-900">{mockApplicationData.applicant.email}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">Phone</dt>
                  <dd className="text-sm text-gray-900">{mockApplicationData.applicant.phone}</dd>
                </div>
                <div className="md:col-span-2">
                  <dt className="text-sm font-medium text-gray-500">Preferred Contact Method</dt>
                  <dd className="text-sm text-gray-900 capitalize">{mockApplicationData.applicant.preferredContact}</dd>
                </div>
              </dl>
            </div>

            {/* Animal Information */}
            <div className="bg-gray-50 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Animal Information</h3>
              {mockApplicationData.animals.map((animal, index) => (
                <div key={index} className="mb-4 last:mb-0">
                  <h4 className="text-md font-medium text-gray-800 mb-2">Animal {index + 1}: {animal.name}</h4>
                  <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Species</dt>
                      <dd className="text-sm text-gray-900">{animal.species}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Breed</dt>
                      <dd className="text-sm text-gray-900">{animal.breed}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Age</dt>
                      <dd className="text-sm text-gray-900">{Math.floor(animal.ageMonths / 12)} years, {animal.ageMonths % 12} months</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Sex</dt>
                      <dd className="text-sm text-gray-900">{animal.sex}</dd>
                    </div>
                    <div className="md:col-span-2">
                      <dt className="text-sm font-medium text-gray-500">Service Needed</dt>
                      <dd className="text-sm text-gray-900">{animal.spayNeuterStatus}</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>

            {/* Veterinarian Selection */}
            <div className="bg-gray-50 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Selected Veterinarian</h3>
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <dt className="text-sm font-medium text-gray-500">Veterinarian</dt>
                  <dd className="text-sm text-gray-900">{mockApplicationData.veterinarian.name}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">Clinic</dt>
                  <dd className="text-sm text-gray-900">{mockApplicationData.veterinarian.clinic}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">Location</dt>
                  <dd className="text-sm text-gray-900">{mockApplicationData.veterinarian.city}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">Phone</dt>
                  <dd className="text-sm text-gray-900">{mockApplicationData.veterinarian.phone}</dd>
                </div>
              </dl>
            </div>

            {/* Financial Information */}
            <div className="bg-gray-50 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Financial Request</h3>
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <dt className="text-sm font-medium text-gray-500">Requested Voucher Amount</dt>
                  <dd className="text-sm text-gray-900">{formatCurrency(mockApplicationData.financial.requestedAmount)}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">Your Match Commitment</dt>
                  <dd className="text-sm text-gray-900">{formatCurrency(mockApplicationData.financial.matchCommitment)}</dd>
                </div>
                <div className="md:col-span-2">
                  <dt className="text-sm font-medium text-gray-500">Total Project Cost</dt>
                  <dd className="text-sm text-gray-900">{formatCurrency(mockApplicationData.financial.requestedAmount + mockApplicationData.financial.matchCommitment)}</dd>
                </div>
              </dl>
            </div>

            {/* Important Notices */}
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-yellow-800 mb-4">Important Information</h3>
              <ul className="text-sm text-yellow-700 space-y-2">
                <li>• Your voucher can only be used at the selected veterinarian's clinic</li>
                <li>• Services must be completed within 6 months of voucher issuance</li>
                <li>• You must bring proof of residency and income verification to your appointment</li>
                <li>• WVDA may contact you for additional information</li>
                <li>• Your reference code is: <strong>{mockApplicationData.referenceCode}</strong></li>
              </ul>
            </div>

            {/* Certification */}
            <div className="bg-red-50 border border-red-200 rounded-lg p-6">
              <FormField
                label="Certification"
                name="certification"
                required
              >
                <div className="flex items-start">
                  <div className="flex items-center h-5">
                    <input
                      id="certification"
                      name="certification"
                      type="checkbox"
                      checked={certificationAccepted}
                      onChange={(e) => setCertificationAccepted(e.target.checked)}
                      className="focus:ring-red-500 h-4 w-4 text-red-600 border-gray-300 rounded"
                    />
                  </div>
                  <div className="ml-3">
                    <label htmlFor="certification" className="text-sm font-medium text-red-800">
                      I certify that the information provided is true and accurate to the best of my knowledge
                    </label>
                    <p className="text-sm text-red-700 mt-1">
                      Providing false information may result in denial of your application and potential legal consequences.
                    </p>
                  </div>
                </div>
              </FormField>
            </div>

            {/* Navigation */}
            <div className="flex justify-between pt-6 border-t border-gray-200">
              <Link href="/apply/evidence">
                <Button variant="outline" type="button">
                  <svg className="mr-2 -ml-1 w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Back
                </Button>
              </Link>

              <Button
                type="submit"
                disabled={!certificationAccepted || isSubmitting}
                loading={isSubmitting}
              >
                {isSubmitting ? 'Submitting Application...' : 'Submit Application'}
                {!isSubmitting && (
                  <svg className="ml-2 -mr-1 w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 111.414-1.414L14.414 11H3a1 1 0 110-2h11.414l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                )}
              </Button>
            </div>
          </form>

          {/* Progress Indicator */}
          <div className="mt-8 pt-6 border-t border-gray-200">
            <div className="flex items-center justify-center">
              <div className="text-center">
                <div className="text-sm text-gray-600">Step 6 of 6</div>
                <div className="text-sm font-medium text-gray-900 mt-1">Ready to Submit!</div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FormField } from '@/components/forms/form-field';
import { Button } from '@/components/forms/button';
import { ELIGIBILITY_RULES, EligibleSpecies } from '@/constants/eligibility-rules';

interface Animal {
  id: string;
  species: EligibleSpecies;
  name: string;
  ageMonths: number;
  sex: 'Male' | 'Female';
  breed: string;
  spayNeuterStatus: 'Already spayed/neutered' | 'Needs spay/neuter' | 'Unsure';
  vetVisitLast12Months: 'Yes' | 'No' | 'Unsure';
  microchipNumber: string;
}

export default function AnimalsPage() {
  const [animalCount, setAnimalCount] = useState(1);
  const [animals, setAnimals] = useState<Animal[]>([
    {
      id: '1',
      species: 'DOG',
      name: '',
      ageMonths: 12,
      sex: 'Male',
      breed: '',
      spayNeuterStatus: 'Needs spay/neuter',
      vetVisitLast12Months: 'Unsure',
      microchipNumber: ''
    }
  ]);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateAnimalCount = (count: number) => {
    setAnimalCount(count);
    setAnimals(prev => {
      const newAnimals = [...prev];
      // Add animals if count increased
      while (newAnimals.length < count) {
        newAnimals.push({
          id: (newAnimals.length + 1).toString(),
          species: 'DOG',
          name: '',
          ageMonths: 12,
          sex: 'Male',
          breed: '',
          spayNeuterStatus: 'Needs spay/neuter',
          vetVisitLast12Months: 'Unsure',
          microchipNumber: ''
        });
      }
      // Remove animals if count decreased
      newAnimals.splice(count);
      return newAnimals;
    });
  };

  const updateAnimal = (index: number, field: keyof Animal, value: string | number) => {
    setAnimals(prev => prev.map((animal, i) =>
      i === index ? { ...animal, [field]: value } : animal
    ));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // Validate all animals meet eligibility requirements
      const invalidAnimals = animals.filter(animal =>
        !isEligibleAnimal(animal.species, animal.ageMonths, animal.spayNeuterStatus)
      );

      if (invalidAnimals.length > 0) {
        alert('Some animals do not meet eligibility requirements. Please review and update as needed.');
        setIsSubmitting(false);
        return;
      }

      // Save to API and offline store (Phase 2: API Integration)

      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Navigate to next step
      window.location.href = '/apply/veterinarian';
    } catch (error) {
      console.error('Error saving animal info:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isEligibleAnimal = (species: string, ageMonths: number, spayNeuterStatus: string): boolean => {
    const speciesEligible = ELIGIBILITY_RULES.ELIGIBLE_SPECIES.includes(species as EligibleSpecies);
    const ageEligible = ageMonths >= ELIGIBILITY_RULES.MIN_ANIMAL_AGE_MONTHS;
    const notAlreadySpayed = spayNeuterStatus.toLowerCase() !== 'already spayed/neutered';

    return speciesEligible && ageEligible && notAlreadySpayed;
  };

  const isFormValid = () => {
    return animals.every(animal =>
      animal.name.trim().length > 0 &&
      animal.breed.trim().length > 0 &&
      animal.ageMonths >= ELIGIBILITY_RULES.MIN_ANIMAL_AGE_MONTHS &&
      animal.spayNeuterStatus !== 'Already spayed/neutered'
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <Link href="/apply/applicant" className="flex items-center">
                <svg className="h-8 w-8 text-blue-600 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                <span className="text-lg font-semibold text-gray-900">Back to Your Info</span>
              </Link>
            </div>
            <div className="text-sm text-gray-600">
              <span className="font-medium">Step 3 of 6:</span> Animal Information
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white rounded-lg shadow-md p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">
              Tell Us About Your Animals
            </h1>
            <p className="text-lg text-gray-600">
              We need information about the animals that will receive spay/neuter services.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-8">
            {/* Animal Count Selection */}
            <div className="bg-gray-50 rounded-lg p-6">
              <FormField
                label="How many animals need spay/neuter services?"
                name="animalCount"
                required
                hint={`You can apply for up to ${ELIGIBILITY_RULES.MAX_ANIMALS_PER_APPLICATION} animals per application`}
              >
                <select
                  value={animalCount}
                  onChange={(e) => updateAnimalCount(parseInt(e.target.value))}
                  className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                >
                  {[1, 2, 3, 4, 5].map(count => (
                    <option key={count} value={count}>
                      {count} {count === 1 ? 'animal' : 'animals'}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>

            {/* Animal Forms */}
            {animals.map((animal, index) => (
              <div key={animal.id} className="bg-gray-50 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Animal {index + 1}
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Species */}
                  <FormField
                    label="Species"
                    name={`species-${animal.id}`}
                    required
                  >
                    <select
                      value={animal.species}
                      onChange={(e) => updateAnimal(index, 'species', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="DOG">Dog</option>
                      <option value="CAT">Cat</option>
                    </select>
                  </FormField>

                  {/* Name */}
                  <FormField
                    label="Name"
                    name={`name-${animal.id}`}
                    required
                  >
                    <input
                      type="text"
                      value={animal.name}
                      onChange={(e) => updateAnimal(index, 'name', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Fluffy"
                    />
                  </FormField>

                  {/* Age */}
                  <FormField
                    label="Approximate Age"
                    name={`age-${animal.id}`}
                    required
                    hint={`Animals must be at least ${ELIGIBILITY_RULES.MIN_ANIMAL_AGE_MONTHS} months old`}
                  >
                    <div className="flex items-center space-x-2">
                      <input
                        type="number"
                        value={animal.ageMonths}
                        onChange={(e) => updateAnimal(index, 'ageMonths', parseInt(e.target.value) || 0)}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        min={ELIGIBILITY_RULES.MIN_ANIMAL_AGE_MONTHS}
                        placeholder="12"
                      />
                      <span className="text-sm text-gray-600">months</span>
                    </div>
                  </FormField>

                  {/* Sex */}
                  <FormField
                    label="Sex"
                    name={`sex-${animal.id}`}
                    required
                  >
                    <select
                      value={animal.sex}
                      onChange={(e) => updateAnimal(index, 'sex', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                    </select>
                  </FormField>

                  {/* Breed */}
                  <FormField
                    label="Breed (or Mix)"
                    name={`breed-${animal.id}`}
                    required
                    hint="If mixed breed, you can say 'Labrador Mix' or 'Unknown'"
                  >
                    <input
                      type="text"
                      value={animal.breed}
                      onChange={(e) => updateAnimal(index, 'breed', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Labrador Retriever"
                    />
                  </FormField>

                  {/* Spay/Neuter Status */}
                  <FormField
                    label="Spay/Neuter Status"
                    name={`spayNeuter-${animal.id}`}
                    required
                  >
                    <select
                      value={animal.spayNeuterStatus}
                      onChange={(e) => updateAnimal(index, 'spayNeuterStatus', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="Needs spay/neuter">Needs spay/neuter</option>
                      <option value="Unsure">Unsure</option>
                      <option value="Already spayed/neutered">Already spayed/neutered (not eligible)</option>
                    </select>
                  </FormField>

                  {/* Vet Visit */}
                  <FormField
                    label="Has this animal been seen by a vet in the last 12 months?"
                    name={`vetVisit-${animal.id}`}
                    required
                  >
                    <select
                      value={animal.vetVisitLast12Months}
                      onChange={(e) => updateAnimal(index, 'vetVisitLast12Months', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                      <option value="Unsure">Unsure</option>
                    </select>
                  </FormField>

                  {/* Microchip */}
                  <FormField
                    label="Microchip Number (Optional)"
                    name={`microchip-${animal.id}`}
                    hint="If you know your pet's microchip number"
                  >
                    <input
                      type="text"
                      value={animal.microchipNumber}
                      onChange={(e) => updateAnimal(index, 'microchipNumber', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="123456789012345"
                    />
                  </FormField>
                </div>

                {/* Eligibility Warning */}
                {!isEligibleAnimal(animal.species, animal.ageMonths, animal.spayNeuterStatus) && (
                  <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-md p-4">
                    <div className="flex">
                      <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      <div className="ml-3">
                        <h3 className="text-sm font-medium text-yellow-800">
                          This animal may not be eligible
                        </h3>
                        <p className="text-sm text-yellow-700 mt-1">
                          Animals must be at least 4 months old and not already spayed/neutered to qualify for vouchers.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Navigation */}
            <div className="flex justify-between pt-6 border-t border-gray-200">
              <Link href="/apply/applicant">
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
                Continue to Vet Selection
                <svg className="ml-2 -mr-1 w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 111.414-1.414L14.414 11H3a1 1 0 110-2h11.414l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </Button>
            </div>
          </form>

          {/* Progress Indicator */}
          <div className="mt-8 pt-6 border-t border-gray-200">
            <div className="flex items-center justify-between text-sm text-gray-600">
              <span>Step 3 of 6</span>
              <span>Your information is saved automatically</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

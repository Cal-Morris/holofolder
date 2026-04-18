"use client"

import { Card } from "@/components/ui/card"

interface PokemonCardProps {
  pokemon: any
}

export default function PokemonCard({ pokemon }: PokemonCardProps) {
  const getTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      normal: "bg-gray-400",
      fire: "bg-red-500",
      water: "bg-blue-500",
      grass: "bg-green-500",
      electric: "bg-yellow-400",
      ice: "bg-cyan-400",
      fighting: "bg-red-700",
      poison: "bg-purple-500",
      ground: "bg-yellow-600",
      flying: "bg-blue-300",
      psychic: "bg-pink-500",
      bug: "bg-green-600",
      rock: "bg-gray-600",
      ghost: "bg-purple-700",
      dragon: "bg-indigo-600",
      dark: "bg-gray-800",
      steel: "bg-gray-400",
      fairy: "bg-pink-300",
    }
    return colors[type] || "bg-gray-500"
  }

  const adjacentPokemon = [
    pokemon.id > 1 ? pokemon.id - 2 : null,
    pokemon.id > 1 ? pokemon.id - 1 : null,
    pokemon.id + 1,
    pokemon.id + 2,
  ].filter(Boolean)

  return (
    <Card className="overflow-hidden border-2 border-primary/20">
      {/* Header with Pokemon Info */}
      <div className="bg-gradient-to-r from-primary to-accent p-6 text-primary-foreground">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-4xl font-bold capitalize mb-1">{pokemon.name}</h2>
            <p className="text-lg opacity-90">National Dex #{pokemon.id}</p>
          </div>
          <img
            src={
              pokemon.sprites?.other?.["official-artwork"]?.front_default ||
              pokemon.sprites?.front_default ||
              "/placeholder.svg"
            }
            alt={pokemon.name}
            className="w-32 h-32 object-contain drop-shadow-lg"
          />
        </div>

        {/* Types */}
        <div className="flex gap-2 flex-wrap">
          {pokemon.types.map((type: any) => (
            <span
              key={type.type.name}
              className={`${getTypeColor(
                type.type.name,
              )} px-3 py-1 rounded-full text-sm font-semibold text-white capitalize`}
            >
              {type.type.name}
            </span>
          ))}
        </div>
      </div>

      {/* Stats and Details */}
      <div className="p-6 space-y-6">
        {/* Base Stats */}
        <div>
          <h3 className="font-bold text-lg mb-4">Base Stats</h3>
          <div className="grid grid-cols-2 gap-4">
            {pokemon.stats.map((stat: any) => (
              <div key={stat.stat.name}>
                <div className="flex justify-between mb-1">
                  <span className="text-sm font-semibold capitalize">{stat.stat.name.replace("-", " ")}</span>
                  <span className="text-sm font-bold text-primary">{stat.base_stat}</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div
                    className="bg-primary h-2 rounded-full transition-all"
                    style={{
                      width: `${Math.min((stat.base_stat / 255) * 100, 100)}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Nearby Pokemon in National Dex */}
        <div>
          <h3 className="font-bold text-lg mb-4">Adjacent National Dex Numbers</h3>
          <div className="grid grid-cols-4 gap-2">
            {[pokemon.id - 2, pokemon.id - 1, pokemon.id, pokemon.id + 1].map((id) => (
              <div
                key={id}
                className={`text-center py-2 px-2 rounded-lg border-2 ${
                  id === pokemon.id ? "bg-primary/20 border-primary font-bold" : "bg-muted border-border"
                }`}
              >
                <div className="text-sm font-semibold">#{id}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Info */}
        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
          <div>
            <p className="text-sm text-muted-foreground mb-1">Height</p>
            <p className="font-semibold">{(pokemon.height / 10).toFixed(1)}m</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-1">Weight</p>
            <p className="font-semibold">{(pokemon.weight / 10).toFixed(1)}kg</p>
          </div>
        </div>
      </div>
    </Card>
  )
}
